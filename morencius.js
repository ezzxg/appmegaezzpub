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
        if (!raw) { nitro.log("❓ [morencius] fetch null " + (tag || "") + " " + url.substring(0, 80)); return null; }
        var j = JSON.parse(raw);
        var st = String(j.status);
        var body = j.body || "";
        nitro.log("📡 [morencius] " + (tag || "GET") + " status=" + st + " len=" + body.length + " head=" + body.substring(0, 60).replace(/[\r\n]+/g, " "));
        if (st !== "200") return null;
        return body;
    } catch (e) {
        nitro.log("❓ [morencius] fetch error " + (tag || "") + ": " + e);
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
        if (!raw) { nitro.log("❓ [morencius] range null " + (tag || "") + " " + url.substring(0, 80)); return null; }
        var j = JSON.parse(raw);
        var st = String(j.status);
        nitro.log("📡 [morencius] " + (tag || "RANGE") + " status=" + st);
        if (st !== "200" && st !== "206") return null;
        return j.body || "";
    } catch (e) {
        nitro.log("❓ [morencius] range error " + (tag || "") + ": " + e);
        return null;
    }
}

// Valida un candidato HLS: master -> variante elegida por ancho de banda -> primer segmento.
// Rechaza los segmentos-farol (tiktokcdn/ad-site/PNG) y URLs muertas.
// Devuelve {ok:true, url:<m3u8 a reproducir>} donde url es la VARIANTE elegida
// (no siempre el master) para fijar una calidad que entre en el throttle del CDN.
var VOD_BAND_CAP = 1000000; // bits/s ~125KB/s: fuerza 480p (733kbps) con margen sobre el throttle real (~200KB/s)
function hlValidate(candidate) {
    try {
        var url = candidate.url;
        var headers = candidate.headers;
        var segBase = url;
        var chosenUrl = url;

        var master = hlGet(url, headers, "MASTER");
        if (!master) { nitro.log("⛔ [morencius] MASTER fail"); return { ok: false }; }
        if (master.indexOf("#EXTM3U") === -1) { nitro.log("⛔ [morencius] master sin #EXTM3U"); return { ok: false }; }

        if (master.indexOf("#EXT-X-STREAM-INF") !== -1) {
            // listar variantes con su BANDWIDTH y elegir la mayor que respete el cap
            var vBands = [];
            var re = /#EXT-X-STREAM-INF:([^\r\n]+)\r?\n([^\s#\r\n]+)/g;
            var vm;
            while ((vm = re.exec(master)) !== null) {
                var bm = vm[1].match(/BANDWIDTH=(\d+)/);
                vBands.push({ band: (bm ? parseInt(bm[1], 10) : 0), ref: vm[2] });
            }
            nitro.log("🎚 [morencius] variantes: " + vBands.map(function (v) { return v.band; }).join(","));
            var best = null;
            for (var vi = vBands.length - 1; vi >= 0; vi--) {
                if (vBands[vi].band > 0 && vBands[vi].band <= VOD_BAND_CAP) { best = vBands[vi]; break; }
            }
            if (!best && vBands.length) best = vBands[0]; // la mas chica como ultimo recurso
            if (!best) { nitro.log("⛔ [morencius] master sin variantes validas"); return { ok: false }; }
            chosenUrl = hlResolve(url, best.ref);
            nitro.log("🎯 [morencius] variante elegida band=" + best.band + " -> " + chosenUrl.substring(0, 110));

            var variantBody = hlGet(chosenUrl, headers, "VARIANT");
            if (!variantBody) { nitro.log("⛔ [morencius] variant fail"); return { ok: false }; }
            if (variantBody.indexOf("#EXTM3U") === -1 || variantBody.indexOf("#EXTINF") === -1) { nitro.log("⛔ [morencius] variant sin EXTINF"); return { ok: false }; }
            segBase = chosenUrl;
            master = variantBody;
        }

        if (master.indexOf("#EXTINF") === -1) { nitro.log("⛔ [morencius] sin EXTINF"); return { ok: false }; }
        var segRef = hlLastRef(master);
        if (!segRef) { nitro.log("⛔ [morencius] playlist sin segmentos"); return { ok: false }; }
        nitro.log("🔎 [morencius] segRef=" + segRef.substring(0, 100));
        if (/tiktokcdn|ad-site-|imagex|\.png$/i.test(segRef)) { nitro.log("⛔ [morencius] DECOY detectado (tiktok/png)"); return { ok: false }; }

        var segUrl = hlResolve(segBase, segRef);
        var probe = hlGetRange(segUrl, headers, 255, "SEG");
        if (probe === null || probe.length === 0) { nitro.log("⛔ [morencius] segmento no sirvio"); return { ok: false }; }
        // MPEG-TS: primer byte 0x47 ('G'). Otros contenedores (MKV/fMP4 pueden no serlo):
        if (probe.charAt(0) === "G") { nitro.log("✅ [morencius] segmento TS valido"); return { ok: true, url: chosenUrl }; }
        // fMP4: caja 'ftyp'; MKV: 0x1A45DFA3 (ojo con corrimiento UTF-8) -> aceptamos largo razonable
        if (probe.indexOf("ftyp") !== -1) { nitro.log("✅ [morencius] segmento fMP4 valido"); return { ok: true, url: chosenUrl }; }
        nitro.log("⛔ [morencius] primer byte no es TS ('" + probe.charAt(0) + "' 0x" + probe.charCodeAt(0).toString(16) + "), len=" + probe.length);
        if (probe.length >= 100) return { ok: true, url: chosenUrl };
        return { ok: false };
    } catch (e) {
        nitro.log("❌ [morencius] validate error: " + e);
        return { ok: false };
    }
}

// Emite el beacon de sesion si existe "/dl?op=view..." en el JS desempacado
async function hlBeacon(unpacked, pageUrl) {
    try {
        var m = unpacked.match(/['"](\/dl\?op=view[^"']+)['"]/) ||
                unpacked.match(/['"](https?:\/\/[^"']+\/dl\?op=view[^"']+)['"]/);
        if (!m) { nitro.log("📶 [morencius] sin beacon /dl en el page"); return false; }
        var beaconUrl = hlResolve(pageUrl, m[1]);
        var headers = { "Referer": pageUrl, "User-Agent": hlUa() };
        var resp = null;
        try {
            resp = nitro.fetchFull(beaconUrl, "GET", null, JSON.stringify(headers));
        } catch (e) { resp = null; }
        nitro.log("📶 [morencius] beacon -> " + beaconUrl.substring(0, 90) + " ... status=" + (resp ? ("" + resp).substring(0, 40) : "null"));
        return true;
    } catch (e) {
        nitro.log("❌ [morencius] beacon error: " + e);
        return false;
    }
}

async function extract(url) {
    nitro.log("🔍 Nitro Driver Cloud: Morencius v1 (hls4 + band-cap) activado");

    var result = await folllowRecursiveJ3(url, 0);
    if (result) return result;

    nitro.log("⚡ Rastreo directo fallo. Cazando espejos...");
    var mirrors = [
        "hanerix.com", "audinifer.com", "vibuxer.com",
        "audinifer.com", "vibuxer.com"
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
        "Referer": "https://pelisplus.zip/",
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
            // Normalizar barras escapadas (\u002f o \/) que el unpack puede dejar intactas
            unpacked = ("" + unpacked).replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/").replace(/\\u002d/g, "-");
            var cands = buildCandidates(unpacked, currentUrl);
            nitro.log("🧩 [morencius] candidatos construidos: " + cands.length);
            for (var ci = 0; ci < cands.length; ci++) {
                nitro.log("🧩 [morencius] cand[" + ci + "]: " + cands[ci].url.substring(0, 110));
            }
            if (cands.length > 0) {
                return pickBestStreamJ3(cands, unpacked, currentUrl);
            }
            // fallback viejo: primer m3u8 absoluto (con aviso)
            var m3u8Match = unpacked.match(/(https?:\/\/[^"']+\.(?:m3u8|txt|urlset)[^"']*)/);
            if (m3u8Match) {
                nitro.log("⚠️ [morencius] fallback primer-m3u8: " + m3u8Match[1].substring(0, 110));
                return hlBuild(m3u8Match[1], currentUrl);
            }
            nitro.log("🚫 [morencius] ni candidatos ni fallback; head=" + ("" + unpacked).substring(0, 200));
        } catch (e) {
            nitro.log("❌ [morencius] unpack error: " + e);
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

// Construye candidatos en prioridad hls4 -> hls3 -> hls2 desde el JS desempacado.
// hls4 puede venir RELATIVO (/stream/...) -> se resuelve contra el dominio del embed.
function buildCandidates(unpacked, pageUrl) {
    var cands = [];
    var hls4 = unpacked.match(/"((?:\/|https?:\/\/[^"]*)stream\/[^"]*\/master\.m3u8[^"]*)"/i);
    var hls3 = unpacked.match(/"(https?:\/\/[^"]*\/hls3\/[^"]*\/master\.(?:txt|m3u8)[^"]*)"/i) ||
               unpacked.match(/"(https?:\/\/[^"]*\/master\.(?:txt|m3u8)[^"]*)"/i);
    var hls2 = unpacked.match(/"(https?:\/\/[^"]*\/hls2\/[^"]*\/master\.m3u8[^"]*)"/i);
    if (hls4) cands.push(hlBuild(hlResolve(pageUrl, hls4[1]), pageUrl));
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
        nitro.log("🧪 [morencius] validando " + (i + 1) + "/" + cands.length + ": " + cands[i].url.substring(0, 90));
        var verdict = await hlValidate(cands[i]);
        if (verdict && verdict.ok) {
            var out = cands[i];
            if (verdict.url && verdict.url !== cands[i].url) {
                out = { url: verdict.url, headers: cands[i].headers };
            }
            nitro.log("✅ [morencius] criterio OK -> " + out.url.substring(0, 120));
            return out;
        }
        nitro.log("⛔ [morencius] invalido: " + cands[i].url.substring(0, 90));
    }
    nitro.log("⚠️ [morencius] ningun candidato valido; devolviendo el 1ro (hls4) como fallback");
    return cands[0];
}
