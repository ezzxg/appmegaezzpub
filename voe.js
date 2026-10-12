/**
 * Nitro Driver para VOE (voe.sx/e/... y mirrors rotativos) — VOD
 *
 * v3 — EXTRACCION ESTATICA COMPLETA (sin WebView, sin clicker):
 * 1. GET embed -> pagina JS de redireccion al mirror actual (window.location.href).
 * 2. GET mirror -> gate ALTCHA: form POST con _token (CSRF) + challenge URL.
 * 3. GET challenge JSON -> parametros PBKDF2/SHA-256 (cost=10000, keyPrefix="00").
 * 4. PoW: PBKDF2-HMAC-SHA256(password = nonce || BE32(counter), salt hex, cost)
 *    hasta que la derived key arranque con el byte del keyPrefix (0x00).
 *    Se resuelve con crypto.subtle (WebCrypto nativo del WebView, contexto about:blank
 *    es trustworthy) — no requiere el widget ALTCHA ni su clicker.
 * 5. POST del form con el payload v2 del widget:
 *    {challenge:{parameters,signature}, solution:{counter,derivedKey,time}}
 *    Los campos van en la QUERY STRING (Laravel lee input() desde ahi) porque el
 *    puente fetchFull solo envia bodies application/json; el form espera urlencoded.
 * 6. El player page contiene <script type="application/json"> con un blob ofuscado:
 *    ROT13 -> strip separadores (@$ ^^ ~@ %? *~ !! #&) -> base64 -> Caesar -3
 *    -> reverse -> base64 -> JSON {source: <master.m3u8>, fallback:[{file:mp4}]}.
 * 7. Se devuelve source (HLS adaptativo) con Referer/Origin del mirror + UA movil.
 *
 * Fallbacks: sin gate -> decode directo; POST rechazado -> 1 reintento del proceso;
 * sin source -> fallback MP4 -> direct_access_url -> null.
 */

// IMPORTANTE: el motor inyecta (async IIFE)() ANTES de este texto y las function
// declarations se elevan (hoisting), pero const/let NO. Cualquier binding de nivel
// superior usado durante la fase sincrónica de extract() debe ser una function,
// nunca un const (ReferenceError temporal -> onError inmediato).
function voeUa() {
    return "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36";
}

function voeRot13(text) {
    var out = "";
    for (var i = 0; i < text.length; i++) {
        var c = text.charCodeAt(i);
        if (c >= 65 && c <= 90) {
            out += String.fromCharCode(((c - 65 + 13) % 26) + 65);
        } else if (c >= 97 && c <= 122) {
            out += String.fromCharCode(((c - 97 + 13) % 26) + 97);
        } else {
            out += text.charAt(i);
        }
    }
    return out;
}

function voeB64Decode(s) {
    try {
        var pad = s.length % 4;
        if (pad === 2) s += "==";
        else if (pad === 3) s += "=";
        else if (pad === 1) s += "===";
        var bin = atob(s);
        return bin;
    } catch (e) {
        return null;
    }
}

function voeDecodeBlob(obf) {
    var s = voeRot13(obf);
    s = s.replace(/@\$/g, "").replace(/\^\^/g, "").replace(/~@/g, "")
         .replace(/%\?/g, "").replace(/\*~/g, "").replace(/!!/g, "")
         .replace(/#&/g, "");
    var b1 = voeB64Decode(s);
    if (b1 === null) return null;
    var shifted = "";
    for (var i = 0; i < b1.length; i++) {
        shifted += String.fromCharCode(b1.charCodeAt(i) - 3);
    }
    var rev = shifted.split("").reverse().join("");
    var b2 = voeB64Decode(rev);
    if (b2 === null) return null;
    try {
        return JSON.parse(b2);
    } catch (e) {
        nitro.log("⚠️ [voe] decode final no es JSON: " + b2.substring(0, 80));
        return null;
    }
}

function voeFindSourcesInHtml(html) {
    if (!html) return null;
    var m = html.match(/<script type="application\/json">([\s\S]*?)<\/script>/);
    if (!m || !m[1]) {
        nitro.log("⚠️ [voe] sin <script type=application/json> en el HTML");
        return null;
    }
    var arr = null;
    try { arr = JSON.parse(m[1].trim()); } catch (e) {}
    if (!arr || !arr.length || typeof arr[0] !== "string") {
        nitro.log("⚠️ [voe] blob JSON no es array de strings");
        return null;
    }
    return voeDecodeBlob(arr[0]);
}

function voeHexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
}

function voeBytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
        var h = bytes[i].toString(16);
        out += h.length === 1 ? "0" + h : h;
    }
    return out;
}

async function voeSolvePow(chal) {
    if (typeof crypto === "undefined" || !crypto.subtle) {
        nitro.log("❌ [voe] crypto.subtle NO disponible en este contexto");
        return null;
    }
    var p = chal.parameters;
    var cost = parseInt(p.cost, 10) || 10000;
    var keyLen = parseInt(p.keyLength, 10) || 32;
    var nonceBytes = voeHexToBytes(p.nonce);
    var saltBytes = voeHexToBytes(p.salt);
    var prefixByte = parseInt(p.keyPrefix.substring(0, 2), 16);

    var start = Date.now();
    var MAX_MS = 34000;
    var MAX_COUNTER = 8192;
    // El widget ALTCHA resuelve con N workers en paralelo; aqui simulamos lo mismo:
    // WebCrypto (Chromium) ejecuta los deriveKey concurrentes en su thread pool,
    // ganando ~Nx velocidad de cores vs. el PoW secuencial (que superaba los 45s
    // del motor en TVs lentas).
    var WORKERS = 12;

    var nextCounter = { v: 0 };
    var found = { v: null };

    async function worker() {
        while (found.v === null && nextCounter.v < MAX_COUNTER && (Date.now() - start) < MAX_MS) {
            var c = nextCounter.v++;
            if (found.v !== null) return;
            try {
                var password = new Uint8Array(nonceBytes.length + 4);
                password.set(nonceBytes, 0);
                password[nonceBytes.length] = (c >>> 24) & 0xFF;
                password[nonceBytes.length + 1] = (c >>> 16) & 0xFF;
                password[nonceBytes.length + 2] = (c >>> 8) & 0xFF;
                password[nonceBytes.length + 3] = c & 0xFF;

                var keyMaterial = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveKey"]);
                var dk = await crypto.subtle.deriveKey(
                    { name: "PBKDF2", salt: saltBytes, iterations: cost, hash: "SHA-256" },
                    keyMaterial,
                    { name: "AES-GCM", length: keyLen * 8 },
                    true,
                    ["encrypt"]
                );
                var raw = new Uint8Array(await crypto.subtle.exportKey("raw", dk));
                if (raw[0] === prefixByte && found.v === null) {
                    found.v = { counter: c, derivedKey: voeBytesToHex(raw), time: Date.now() - start };
                }
            } catch (e) {
                nitro.log("⚠️ [voe] worker error counter " + c + ": " + e.message);
            }
        }
    }

    var pool = [];
    for (var i = 0; i < WORKERS; i++) pool.push(worker());
    await Promise.all(pool);

    if (found.v) {
        nitro.log("✅ [voe] PoW resuelto: counter=" + found.v.counter + " en " + found.v.time + "ms (paralelo)");
        return found.v;
    }
    nitro.log("❌ [voe] PoW sin solucion (timeout " + MAX_MS + "ms o max counters)");
    return null;
}

function voeBuildHeaders(origin, cookie) {
    var h = {
        "User-Agent": voeUa(),
        "Referer": origin + "/",
        "Origin": origin,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    };
    if (cookie) h["Cookie"] = cookie;
    return h;
}

function voeFetch(url, method, body, headers) {
    var respJson = nitro.fetchFull(url, method || "GET", body || null, JSON.stringify(headers || {}));
    try { return JSON.parse(respJson || "{}"); } catch (e) { return null; }
}

async function voeExtractOnce(url, attempt) {
    var origin0 = "https://voe.sx";
    try { origin0 = "https://" + url.split("/")[2]; } catch (e) {}

    // 1) Embed -> mirror actual (redireccion JS)
    var emb = voeFetch(url, "GET", null, voeBuildHeaders(origin0));
    if (!emb || !emb.body) {
        nitro.log("❌ [voe] sin respuesta del embed (status " + (emb ? emb.status : "?") + ")");
        return null;
    }
    var html = emb.body;
    var mirror = url;
    var mm = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/)
          || html.match(/window\.location\s*=\s*['"]([^'"]+)['"]/)
          || html.match(/location\.href\s*=\s*['"]([^'"]+)['"]/)
          || html.match(/location\.replace\(\s*['"]([^'"]+)['"]\s*\)/);
    if (mm && mm[1].indexOf("http") === 0) {
        mirror = mm[1];
        nitro.log("🔀 [voe] intento " + attempt + " mirror: " + mirror);
    }

    // Si ya es el player page (sin gate), decode directo
    if (html.indexOf('type="application/json"') !== -1 && html.indexOf("altcha-widget") === -1) {
        var direct = voeFindSourcesInHtml(html);
        if (direct && (direct.source || direct.fallback)) return { sources: direct, mirror: mirror };
    }

    // 2) Gate ALTCHA
    var gate = voeFetch(mirror, "GET", null, voeBuildHeaders(origin0));
    if (!gate || !gate.body) {
        nitro.log("❌ [voe] sin respuesta del gate");
        return null;
    }
    html = gate.body;
    if (html.indexOf("altcha-widget") === -1) {
        // Sin gate: puede ser player page directo o página de error
        var noGate = voeFindSourcesInHtml(html);
        if (noGate && (noGate.source || noGate.fallback)) return { sources: noGate, mirror: mirror };
        nitro.log("⚠️ [voe] sin gate y sin fuentes (¿enlace muerto?)");
        return null;
    }

    var tm = html.match(/name="_token"\s+value="([^"]+)"/) || html.match(/csrf-token"\s+content="([^"]+)"/);
    var chalUrlM = html.match(/challenge="([^"]+)"/);
    if (!tm || !chalUrlM) {
        nitro.log("❌ [voe] gate sin token o challenge URL");
        return null;
    }
    var token = tm[1];
    var chalUrl = chalUrlM[1];
    var mirrorOrigin = "https://" + chalUrl.split("/")[2];
    var gateCookie = null;
    if (gate.headers) {
        gateCookie = gate.headers["Set-Cookie"] || gate.headers["set-cookie"] || null;
    }

    // 3) Challenge JSON
    var chalResp = voeFetch(chalUrl, "GET", null, voeBuildHeaders(mirrorOrigin, gateCookie));
    if (!chalResp || !chalResp.body) {
        nitro.log("❌ [voe] sin challenge JSON (status " + (chalResp ? chalResp.status : "?") + ")");
        return null;
    }
    var chal = null;
    try { chal = JSON.parse(chalResp.body); } catch (e) {}
    if (!chal || !chal.parameters || !chal.parameters.algorithm) {
        nitro.log("❌ [voe] challenge JSON invalido");
        return null;
    }
    if (chal.parameters.algorithm !== "PBKDF2/SHA-256") {
        nitro.log("⚠️ [voe] algoritmo no soportado: " + chal.parameters.algorithm);
        return null;
    }
    var nowSec = Math.floor(Date.now() / 1000);
    // Solo refetch si el dispositivo cree que el challenge esta muy vencido
    // (hay TVs con relojes desfasados; el servidor valida con su propio reloj).
    if (chal.parameters.expiresAt && nowSec > chal.parameters.expiresAt + 60) {
        nitro.log("⚠️ [voe] challenge expirado por reloj local, refetch");
        chalResp = voeFetch(chalUrl, "GET", null, voeBuildHeaders(mirrorOrigin, gateCookie));
        try { chal = JSON.parse(chalResp.body); } catch (e) {}
        if (!chal || !chal.parameters) return null;
    }

    // 4) PoW
    var solution = await voeSolvePow(chal);
    if (!solution) return null;

    // 5) POST del form (campos en query string + body JSON vacio)
    var payload = {
        challenge: { parameters: chal.parameters, signature: chal.signature },
        solution: solution
    };
    var altcha = btoa(JSON.stringify(payload));
    var postUrl = mirror + "?_token=" + encodeURIComponent(token) +
                  "&access=0&altcha=" + encodeURIComponent(altcha);
    var post = voeFetch(postUrl, "POST", "{}", voeBuildHeaders(mirrorOrigin, gateCookie));
    if (!post || !post.body) {
        nitro.log("❌ [voe] POST sin respuesta (status " + (post ? post.status : "?") + ")");
        return null;
    }
    if (post.body.indexOf("altcha-widget") !== -1) {
        nitro.log("⚠️ [voe] POST rechazado (gate devuelto) intento " + attempt);
        return null;
    }

    // 6) Decode del player page
    var sources = voeFindSourcesInHtml(post.body);
    if (!sources) return null;
    return { sources: sources, mirror: mirror };
}

function voeResult(bundle) {
    var sources = bundle.sources;
    var origin = "https://voe.sx";
    try {
        origin = "https://" + bundle.mirror.split("/")[2];
    } catch (e) {}
    var headers = {
        "User-Agent": voeUa(),
        "Referer": origin + "/",
        "Origin": origin
    };

    if (sources.source && sources.source.indexOf("http") === 0) {
        nitro.log("✅ [voe] master HLS: " + sources.source.substring(0, 120) + "...");
        return { url: sources.source, headers: headers };
    }
    if (sources.fallback && sources.fallback.length && sources.fallback[0].file) {
        nitro.log("✅ [voe] fallback MP4: " + sources.fallback[0].file.substring(0, 120) + "...");
        return { url: sources.fallback[0].file, headers: headers };
    }
    if (sources.direct_access_url && sources.direct_access_url.indexOf("http") === 0) {
        nitro.log("✅ [voe] direct_access_url: " + sources.direct_access_url.substring(0, 120) + "...");
        return { url: sources.direct_access_url, headers: headers };
    }
    nitro.log("⚠️ [voe] JSON decodificado pero sin URL utilizable");
    return null;
}

async function extract(url) {
    nitro.log("🔍 [voe] Iniciando extraccion estatica para: " + url);

    for (var attempt = 1; attempt <= 2; attempt++) {
        try {
            var bundle = await voeExtractOnce(url, attempt);
            if (bundle && bundle.sources) {
                var result = voeResult(bundle);
                if (result) {
                    nitro.onResult(JSON.stringify(result));
                    return result;
                }
            }
        } catch (e) {
            nitro.log("❌ [voe] excepcion intento " + attempt + ": " + e.message);
        }
    }

    nitro.log("❌ [voe] extraccion fallida tras 2 intentos");
    nitro.onResult(JSON.stringify(null));
    return null;
}
