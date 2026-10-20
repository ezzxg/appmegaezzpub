/**
 * [v55.13.5] Driver Nitro Cloud: HgLink v3 (Prioridad hls4 /stream/ + beacon + validacion de decoys)
 *
 * Flujo vidhide-family (hglink/hanerix/etc.): el embed usa jwplayer con
 *   sources:[{file: links.hls4 || links.hls3 || links.hls2}]
 * - links.hls4 es RELATIVO: "/stream/<tok>/<key>/<ts>/<fileid>/master.m3u8" y vive en el
 *   dominio del embed (ej: hanerix.com). Es el que reproducen los navegadores.
 * - links.hls3 y links.hls2 son absolutos (hls2 premilkyway suele estar inaccesible/bloqueado).
 * - El embed dispara un beacon "/dl?op=view&file_code=<code>&hash=<...>&hls4=1" al reproducir:
 *   sin ese beacon el CDN puede servir segmentos-farol (PNG imitando segmentos).
 *
 * Estrategia: emite beacon, luego valida candidatos en orden hls4 -> hls3 -> hls2 con una
 * sonda de segmento real (Range 0-255, primer byte 0x47 = 'G' de MPEG-TS, o payload largo
 * para MKV/fMP4). Devuelve el primero que pase; si ninguno pasa, devuelve hls4 como ultimo
 * recurso (mantiene el comportamiento de la v2).
 */
function hlUa() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
}

function hlOrigin(u) {
    var m = (u || "").match(/^(https?:\/\/[^\/]+)/);
    return m ? m[1] : "";
}

function hlResolve(base, ref) {
    ref = (ref || "").trim();
    if (/^https?:\/\//i.test(ref)) return ref;
    if (ref.charAt(0) === "/") {
        var o = hlOrigin(base);
        return o ? (o + ref) : ref;
    }
    var cut = base.lastIndexOf("/");
    return (cut === -1 ? base : base.slice(0, cut + 1)) + ref;
}

function hlBuild(streamUrl, refererUrl) {
    var u = streamUrl.replace(/\\/g, "");
    return {
        url: u,
        headers: {
            "Referer": refererUrl,
            "Origin": hlOrigin(refererUrl),
            "User-Agent": hlUa()
        }
    };
}

function hlLastRef(body) {
    var lines = body.split(/\r?\n/);
    for (var i = lines.length - 1; i >= 0; i--) {
        var L = lines[i].trim();
        if (!L || L.charAt(0) === "#") continue;
        return L;
    }
    return "";
}

function hlGet(url, headers, tag) {
    try {
        var raw = nitro.fetchFull(url, "GET", null, JSON.stringify(headers || {}));
        if (!raw) { nitro.log("❓ [hglink] fetch null " + (tag || "") + " " + url.substring(0, 80)); return null; }
        var j = JSON.parse(raw);
        var st = String(j.status);
        var body = j.body || "";
        nitro.log("📡 [hglink] " + (tag || "GET") + " status=" + st + " len=" + body.length + " head=" + body.substring(0, 60).replace(/[\r\n]+/g, " "));
        if (st !== "200") return null;
        return body;
    } catch (e) {
        nitro.log("❓ [hglink] fetch error " + (tag || "") + ": " + e);
        return null;
    }
}

function hlGetRange(url, headers, bytes, tag) {
    var h = {
        "Referer": "", "Origin": "", "User-Agent": ""
    };
    try {
        var src = typeof headers === "string" ? JSON.parse(headers || "{}") : (headers || {});
        for (var k in src) { if (src.hasOwnProperty(k)) h[k] = src[k]; }
    } catch (e) {}
    h["Range"] = "bytes=0-" + bytes;
    try {
        var raw = nitro.fetchFull(url, "GET", null, JSON.stringify(h));
        if (!raw) { nitro.log("❓ [hglink] range null " + (tag || "") + " " + url.substring(0, 80)); return null; }
        var j = JSON.parse(raw);
        var st = String(j.status);
        nitro.log("📡 [hglink] " + (tag || "RANGE") + " status=" + st);
        if (st !== "200" && st !== "206") return null;
        return j.body || "";
    } catch (e) {
        nitro.log("❓ [hglink] range error " + (tag || "") + ": " + e);
        return null;
    }
}

// Valida un candidato HLS: master -> ultima variante -> primer segmento.
// Rechaza los segmentos-farol (tiktokcdn/ad-site/PNG) y URLs muertas.
function hlValidate(candidate) {
    try {
        var url = candidate.url;
        var headers = candidate.headers;
        var segBase = url;

        var master = hlGet(url, headers, "MASTER");
        if (!master) { nitro.log("⛔ [hglink] MASTER fail"); return false; }
        if (master.indexOf("#EXTM3U") === -1) { nitro.log("⛔ [hglink] master sin #EXTM3U"); return false; }

        if (master.indexOf("#EXT-X-STREAM-INF") !== -1) {
            var variantRef = hlLastRef(master);
            if (!variantRef) { nitro.log("⛔ [hglink] master sin variantes"); return false; }
            var variantUrl = hlResolve(url, variantRef);
            var variantBody = hlGet(variantUrl, headers, "VARIANT");
            if (!variantBody) { nitro.log("⛔ [hglink] variant fail"); return false; }
            if (variantBody.indexOf("#EXTM3U") === -1 || variantBody.indexOf("#EXTINF") === -1) { nitro.log("⛔ [hglink] variant sin EXTINF"); return false; }
            segBase = variantUrl;
            master = variantBody;
        }

        if (master.indexOf("#EXTINF") === -1) { nitro.log("⛔ [hglink] sin EXTINF"); return false; }
        var segRef = hlLastRef(master);
        if (!segRef) { nitro.log("⛔ [hglink] playlist sin segmentos"); return false; }
        nitro.log("🔎 [hglink] segRef=" + segRef.substring(0, 100));
        if (/tiktokcdn|ad-site-|imagex|\.png$/i.test(segRef)) { nitro.log("⛔ [hglink] DECOY detectado (tiktok/png)"); return false; }

        var segUrl = hlResolve(segBase, segRef);
        var probe = hlGetRange(segUrl, headers, 255, "SEG");
        if (probe === null || probe.length === 0) { nitro.log("⛔ [hglink] segmento no sirvio"); return false; }
        // MPEG-TS: primer byte 0x47 ('G'). Otros contenedores (MKV/fMP4 pueden no serlo):
        if (probe.charAt(0) === "G") { nitro.log("✅ [hglink] segmento TS valido"); return true; }
        // fMP4: caja 'ftyp'; MKV: 0x1A45DFA3 (ojo con corrimiento UTF-8) -> aceptamos largo razonable
        if (probe.indexOf("ftyp") !== -1) { nitro.log("✅ [hglink] segmento fMP4 valido"); return true; }
        nitro.log("⛔ [hglink] primer byte no es TS ('" + probe.charAt(0) + "' 0x" + probe.charCodeAt(0).toString(16) + "), len=" + probe.length);
        return probe.length >= 100;
    } catch (e) {
        nitro.log("❌ [hglink] validate error: " + e);
        return false;
    }
}

// Emite el beacon de sesion si existe "/dl?op=view..." en el JS desempacado
async function hlBeacon(unpacked, pageUrl) {
    try {
        var m = unpacked.match(/['"](\/dl\?op=view[^"']+)['"]/) ||
                unpacked.match(/['"](https?:\/\/[^"']+\/dl\?op=view[^"']+)['"]/);
        if (!m) { nitro.log("📶 [hglink] sin beacon /dl en el page"); return false; }
        var beaconUrl = hlResolve(pageUrl, m[1]);
        var headers = { "Referer": pageUrl, "User-Agent": hlUa() };
        var resp = null;
        try {
            resp = nitro.fetchFull(beaconUrl, "GET", null, JSON.stringify(headers));
        } catch (e) { resp = null; }
        nitro.log("📶 [hglink] beacon -> " + beaconUrl.substring(0, 90) + " ... status=" + (resp ? ("" + resp).substring(0, 40) : "null"));
        return true;
    } catch (e) {
        nitro.log("❌ [hglink] beacon error: " + e);
        return false;
    }
}

async function extract(url) {
    nitro.log("🔍 Nitro Driver Cloud: HgLink v3 (hls4 prioritario) activado");

    var result = await folllowRecursiveJ3(url, 0);
    if (result) return result;

    nitro.log("⚡ Rastreo directo fallo. Cazando espejos...");
    var mirrors = [
        "hanerix.com", "audinifer.com", "vibuxer.com",
        "masukestin.com", "strwish.com", "streamwish.to"
    ];

    var videoCode = url.indexOf("/e/") !== -1 ?
        url.split("/e/")[1].split("?")[0].split("/")[0] :
        url.split("/").pop().split("?")[0];

    for (var i = 0; i < mirrors.length; i++) {
        var mirrorUrl = "https://" + mirrors[i] + "/e/" + videoCode;
        nitro.log("🔎 Probando espejo: " + mirrorUrl);
        var html = nitro.fetch(mirrorUrl, JSON.stringify({
            "Referer": url,
            "User-Agent": hlUa()
        }));
        if (html) {
            var found = findStream(html, mirrorUrl);
            if (found) return found;
        }
    }
    return null;
}

async function folllowRecursiveJ3(url, depth) {
    if (depth > 4) return null;

    nitro.log("🔍 Salto " + depth + ": " + url);
    var html = nitro.fetch(url, JSON.stringify({
        "Referer": "https://hglink.to/",
        "User-Agent": hlUa()
    }));

    if (!html) return null;

    var found = findStream(html, url);
    if (found) return found;

    var jsRedirMatch = html.match(/(?:window|location|top)(?:\['location'\])?(?:\['href'\]|\.href)\s*=\s*['"]([^'"]+)['"]/);
    if (jsRedirMatch) {
        var nextUrl = jsRedirMatch[1];
        if (nextUrl.charAt(0) === "/") {
            var domain = url.split("/").slice(0, 3).join("/");
            nextUrl = domain + nextUrl;
        }
        return await folllowRecursiveJ3(nextUrl, depth + 1);
    }
    return null;
}

function findStream(html, currentUrl) {
    var packerRegex = /eval\s*\(\s*function\s*\(p\s*,\s*a\s*,\s*c\s*,\s*k\s*[,e\s*\|,\s*d\s*]*\).*?\}\s*\(\s*['"](.*?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"](.*?)['"]\.split\(['"]\|['"]\)/;
    var pMatch = html.match(packerRegex);
    if (pMatch) {
        try {
            var unpacked = nitro.unpack(pMatch[1], parseInt(pMatch[2]), JSON.stringify(pMatch[4].split("|")));
            var cands = buildCandidates(unpacked, currentUrl);
            if (cands.length > 0) {
                return pickBestStreamJ3(cands, unpacked, currentUrl);
            }
            // fallback viejo: primer m3u8 absoluto
            var m3u8Match = unpacked.match(/(https?:\/\/[^"']+\.(?:m3u8|txt|urlset)[^"']*)/);
            if (m3u8Match) return hlBuild(m3u8Match[1], currentUrl);
        } catch (e) {
            nitro.log("❌ [hglink] unpack error: " + e);
        }
    }

    // relativo directo en HTML crudo (sin packer)
    var relMatch = html.match(/['"](\/stream\/[^'"]*\/master\.m3u8[^'"]*)['"]/i);
    if (relMatch) {
        var cB = [{ url: hlResolve(currentUrl, relMatch[1]), headers: { "Referer": currentUrl, "Origin": hlOrigin(currentUrl), "User-Agent": hlUa() } }];
        return pickBestStreamJ3(cB, html, currentUrl);
    }

    var directMatch = html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|txt|urlset)[^"']*)["']/i);
    if (directMatch) return hlBuild(directMatch[1], currentUrl);

    return null;
}

// Construye candidatos en prioridad hls4 -> hls3 -> hls2 desde el JS desempacado
function buildCandidates(unpacked, pageUrl) {
    var cands = [];
    var hls4 = unpacked.match(/"(\/stream\/[^"]*\/master\.m3u8[^"]*)"/i) ||
               unpacked.match(/"(https?:\/\/[^"]*\/stream\/[^"]*\/master\.m3u8[^"]*)"/i);
    var hls3 = unpacked.match(/"(https?:\/\/[^"]*\/hls3\/[^"]*\/master\.(?:txt|m3u8)[^"]*)"/i) ||
               unpacked.match(/"(https?:\/\/[^"]*\/master\.(?:txt|m3u8)[^"]*)"/i);
    var hls2 = unpacked.match(/"(https?:\/\/[^"]*\/hls2\/[^"]*\/master\.m3u8[^"]*)"/i);
    if (hls4) cands.push(hlBuild(hls4[1], pageUrl));
    if (hls3) cands.push(hlBuild(hls3[1], pageUrl));
    if (hls2) cands.push(hlBuild(hls2[1], pageUrl));
    return cands;
}

// Emite beacon (si existe), valida candidatos en orden y devuelve el primero valido.
// Si nunguno valida, devuelve el primero (hls4) para no romper el flujo actual.
async function pickBestStreamJ3(cands, unpacked, pageUrl) {
    if (unpacked && unpacked.indexOf("op=view") !== -1) {
        await hlBeacon(unpacked, pageUrl);
    }
    for (var i = 0; i < cands.length; i++) {
        nitro.log("🧪 [hglink] validando " + (i + 1) + "/" + cands.length + ": " + cands[i].url.substring(0, 90));
        if (hlValidate(cands[i])) {
            nitro.log("✅ [hglink] criterio OK -> " + cands[i].url.substring(0, 120));
            return cands[i];
        }
        nitro.log("⛔ [hglink] invalido: " + cands[i].url.substring(0, 90));
    }
    nitro.log("⚠️ [hglink] ningun candidato valido; devolviendo el 1ro (hls4) como fallback");
    return cands[0];
}
