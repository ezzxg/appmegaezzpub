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
    var hasSubtle = (typeof crypto !== "undefined" && crypto.subtle);
    if (!hasSubtle) nitro.log("ℹ️ [voe] sin crypto.subtle -> PoW en JS puro (sin WebCrypto)");

    var p = chal.parameters;
    var cost = parseInt(p.cost, 10) || 10000;
    var keyLen = parseInt(p.keyLength, 10) || 32;
    var nonceBytes = voeHexToBytes(p.nonce);
    var saltBytes = voeHexToBytes(p.salt);
    var prefixByte = parseInt(p.keyPrefix.substring(0, 2), 16);

    var start = Date.now();
    var MAX_MS = 34000;
    var MAX_COUNTER = 8192;
    var nextCounter = { v: 0 };
    var found = { v: null };

    // ---------- VIA A: WebCrypto nativo (contextos secure) ----------
    if (hasSubtle) {
        var WORKERS = 12;
        async function subtleWorker() {
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
        for (var i = 0; i < WORKERS; i++) pool.push(subtleWorker());
        await Promise.all(pool);
        if (found.v) {
            nitro.log("✅ [voe] PoW resuelto: counter=" + found.v.counter + " en " + found.v.time + "ms (webcrypto paralelo)");
            return found.v;
        }
        nitro.log("❌ [voe] PoW webcrypto sin solucion (timeout " + MAX_MS + "ms)");
        return null;
    }

    // ---------- VIA B: PBKDF2-HMAC-SHA256 en JS puro ----------
    // Per-counter: ipad/opad precalculados => 2 compresiones SHA por iteracion
    // (~20k compresiones por counter => ~5-20s para ~128-256 counters).
    var core = voeMakeShaCore(); // {block(stateU32, buf, off), makeState()}
    var ipad = new Uint8Array(64);
    var opad = new Uint8Array(64);
    var ipadState = core.makeState();
    var opadState = core.makeState();
    var tmpState = core.makeState();
    var innerBlock = new Uint8Array(64); // U32 + pad; para U1: salt+int + pad
    var outerBlock = new Uint8Array(64); // hash32 + pad
    var innerWork = new Uint8Array(64);
    // preparar buffer base de bloque interno para iteraciones >= 2 (32B + padding + len 768)
    for (var i = 33; i < 62; i++) innerBlock[i] = 0;
    innerBlock[32] = 0x80;
    innerBlock[62] = 0x03; innerBlock[63] = 0x00; // len bits = 768 = 0x0300 BE
    // bloque externo: 32B hash + padding + len 768
    outerBlock[32] = 0x80;
    outerBlock[62] = 0x03; outerBlock[63] = 0x00;

    function deriveCounter(c) {
        // password = nonce(16) || BE32(c)
        var pw = new Uint8Array(nonceBytes.length + 4);
        pw.set(nonceBytes, 0);
        pw[nonceBytes.length] = (c >>> 24) & 0xFF;
        pw[nonceBytes.length + 1] = (c >>> 16) & 0xFF;
        pw[nonceBytes.length + 2] = (c >>> 8) & 0xFF;
        pw[nonceBytes.length + 3] = c & 0xFF;
        for (var i = 0; i < 64; i++) {
            ipad[i] = (i < pw.length ? pw[i] : 0) ^ 0x36;
            opad[i] = (i < pw.length ? pw[i] : 0) ^ 0x5c;
        }
        // estados-base: sha256 init + 1 bloque
        core.initFrom(ipadState);
        core.block(ipadState, ipad, 0);
        core.initFrom(opadState);
        core.block(opadState, opad, 0);

        // U1: bloque2 con datos de 20B: salt(16)+intBE(1)+0x80+zeros+BE64(672)
        for (var i = 0; i < 16; i++) innerBlock[i] = saltBytes[i];
        innerBlock[16] = 0; innerBlock[17] = 0; innerBlock[18] = 0; innerBlock[19] = 1;
        innerBlock[20] = 0x80;
        for (var i = 21; i < 56; i++) innerBlock[i] = 0;
        innerBlock[60] = 0; innerBlock[61] = 0; innerBlock[62] = 0x02; innerBlock[63] = 0xA0;
        core.copyState(tmpState, ipadState);
        core.block(tmpState, innerBlock, 0);
        // outer: innerHash -> opadState + bloque
        for (var i = 0; i < 32; i++) outerBlock[i] = tmpState.bytes[i];
        core.copyState(tmpState, opadState);
        core.block(tmpState, outerBlock, 0);
        var U = tmpState.bytes; // 32B

        for (var it = 1; it < cost; it++) {
            // inner: ipadState + bloque(U32)
            for (var i = 0; i < 32; i++) innerBlock[i] = U[i];
            core.copyState(tmpState, ipadState);
            core.block(tmpState, innerBlock, 0);
            for (var i = 0; i < 32; i++) outerBlock[i] = tmpState.bytes[i];
            core.copyState(tmpState, opadState);
            core.block(tmpState, outerBlock, 0);
        }
        return tmpState.bytes;
    }

    var tick = start;
    while (found.v === null && nextCounter.v < MAX_COUNTER && (Date.now() - start) < MAX_MS) {
        var c = nextCounter.v++;
        var raw = deriveCounter(c);
        if (raw[0] === prefixByte) {
            found.v = { counter: c, derivedKey: voeBytesToHex(raw), time: Date.now() - start };
            break;
        }
        if (c % 32 === 0 && c > 0) {
            nitro.log("⏱ [voe] PoW JS puro: " + c + " counters en " + (Date.now() - start) + "ms");
        }
    }
    if (found.v) {
        nitro.log("✅ [voe] PoW resuelto: counter=" + found.v.counter + " en " + found.v.time + "ms (JS puro)");
        return found.v;
    }
    nitro.log("❌ [voe] PoW JS puro sin solucion (timeout " + MAX_MS + "ms o max counters)");
    return null;
}

function voeMakeShaCore() {
    // Uint32Array(8) con vista bytes little... SHA-256 trabaja BE; para extraer el
    // digest como bytes usamos DataView BE sobre un ArrayBuffer compartido.
    var KS = new Uint32Array([
        0x428A2F98,0x71374491,0xB5C0FBCF,0xE9B5DBA5,0x3956C25B,0x59F111F1,0x923F82A4,0xAB1C5ED5,
        0xD807AA98,0x12835B01,0x243185BE,0x550C7DC3,0x72BE5D74,0x80DEB1FE,0x9BDC06A7,0xC19BF174,
        0xE49B69C1,0xEFBE4786,0x0FC19DC6,0x240CA1CC,0x2DE92C6F,0x4A7484AA,0x5CB0A9DC,0x76F988DA,
        0x983E5152,0xA831C66D,0xB00327C8,0xBF597FC7,0xC6E00BF3,0xD5A79147,0x06CA6351,0x14292967,
        0x27B70A85,0x2E1B2138,0x4D2C6DFC,0x53380D13,0x650A7354,0x766A0ABB,0x81C2C92E,0x92722C85,
        0xA2BFE8A1,0xA81A664B,0xC24B8B70,0xC76C51A3,0xD192E819,0xD6990624,0xF40E3585,0x106AA070,
        0x19A4C116,0x1E376C08,0x2748774C,0x34B0BCB5,0x391C0CB3,0x4ED8AA4A,0x5B9CCA4F,0x682E6FF3,
        0x748F82EE,0x78A5636F,0x84C87814,0x8CC70208,0x90BEFFFA,0xA4506CEB,0xBEF9A3F7,0xC67178F2
    ]);
    var K = new Uint32Array(KS); // copia propia
    var w = new Uint32Array(64);
    var scratch = new Uint8Array(64);

    var ST = new Uint32Array(8);

    // factory de estado: state = {w: Uint32Array(8), buf: Uint8Array(32) sobre el mismo}
    function makeState() {
        var ab = new ArrayBuffer(32);
        return {
            w: new Uint32Array(ab, 0, 8),
            bytes: new Uint8Array(ab)
        };
    }
    function initFrom(dstU32) {
        dstU32[0] = 0x6A09E667; dstU32[1] = 0xBB67AE85; dstU32[2] = 0x3C6EF372; dstU32[3] = 0xA54FF53A;
        dstU32[4] = 0x510E527F; dstU32[5] = 0x9B05688C; dstU32[6] = 0x1F83D9AB; dstU32[7] = 0x5BE0CD19;
    }
    function copyState(dstU32, srcU32) {
        for (var i = 0; i < 8; i++) dstU32[i] = srcU32[i];
    }

    // procesa UN bloque de 64 bytes sobre state (Uint32Array vista del ArrayBuffer)
    function block(stateU32, buf, off) {
        var h = ST;
        for (var i = 0; i < 8; i++) h[i] = stateU32[i];
        for (var i = 0; i < 16; i++) {
            var j = off + i * 4;
            w[i] = ((buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3]) >>> 0;
        }
        for (var i = 16; i < 64; i++) {
            var x = w[i - 15], y = w[i - 2];
            var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
            var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (var i = 0; i < 64; i++) {
            var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            var ch = (e & f) ^ (~e & g);
            var t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
            var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            var mj = (a & b) ^ (a & c) ^ (b & c);
            var t2 = (S0 + mj) >>> 0;
            hh = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        stateU32[0] = (stateU32[0] + a) >>> 0;
        stateU32[1] = (stateU32[1] + b) >>> 0;
        stateU32[2] = (stateU32[2] + c) >>> 0;
        stateU32[3] = (stateU32[3] + d) >>> 0;
        stateU32[4] = (stateU32[4] + e) >>> 0;
        stateU32[5] = (stateU32[5] + f) >>> 0;
        stateU32[6] = (stateU32[6] + g) >>> 0;
        stateU32[7] = (stateU32[7] + hh) >>> 0;
    }

    return { makeState: makeState, initFrom: initFrom, copyState: copyState, block: block, scratch: scratch };
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

    // self-test del SHA-256 en JS puro (valida la implementacion contra "abc")
    try {
        var core = voeMakeShaCore();
        var st = core.makeState();
        core.initFrom(st.w);
        var blk = new Uint8Array(64);
        blk[0] = 0x61; blk[1] = 0x62; blk[2] = 0x63; blk[3] = 0x80;
        blk[63] = 24; // bits = 24
        core.block(st.w, blk, 0);
        nitro.log("🧪 [voe] selftest sha256('abc')=" + voeBytesToHex(st.bytes) + " (esperado ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad)");
    } catch (e) {}

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
