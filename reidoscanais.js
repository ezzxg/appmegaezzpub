/**
 * Nitro Driver: reidoscanais.im (eventos deportivos, pagina por evento)
 *
 * Entrada:
 *   https://reidoscanais.im/assistir/<slug>
 *
 * Cadena (verificada 2026-11-14 con "irlanda-do-norte-x-ucrania"):
 *   1) La pagina Next.js (App Router) trae los players embebidos en el payload RSC:
 *        \"provider\":\"Disney+\",\"quality\":\"HD\",\"embed_url\":\"https://esportesembed.cc/<slug>-1\"
 *   2) esportesembed.cc/<slug>-N -> HTML minimo con un iframe:
 *        https://mastruzcomleite.site/play/<slug>[-sd].html
 *   3) Ese player trae un div con el blob ofuscado en base64 INVERTIDO:
 *        <div id="player" data-c="...">
 *      decoded = base64(reverse(data-c)) -> JSON:
 *        {"u":["https://atlas.mediastream.best/live/secure/<tk>/<exp>/<hash>/<slug>/index.m3u8",
 *              "https://asgard.fastimg.live/live/secure/..."],
 *         "s":"rdc:<slug>","t":"<slug>","a":["rdcanis.org", ...]}
 *   4) El token caduca (~6 h): se resuelve en cada extraccion, no cachear.
 *
 * Segmentos: son el "poliglota PNG+TS" ya conocido (p16.tiktokcdn.com/...image):
 *   PNG 1x1 de ~67 bytes + MPEG-TS real pegado despues. content-type image/png a proposito.
 *   Media3 1.3.1 lo reproduce (TsExtractor.sniff busca 0x47 cada 188 bytes desde 0..187 y
 *   hace skipFully(offset)). El probe valida el TS pidiendo Range desde el byte 0x47.
 *
 * El m3u8 y los segmentos responden sin Referer; igual se mandan los del player.
 *
 * Regla del motor: SOLO `function` en nivel superior (nada de const/let), porque el script
 * se inyecta DESPUES del IIFE que llama a extract().
 */

function rdcUa() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
}

function rdcOrigin(u) {
    var m = (u || "").match(/^(https?:\/\/[^\/]+)/);
    return m ? m[1] : "";
}

function rdcResolve(base, ref) {
    ref = (ref || "").trim();
    if (/^https?:\/\//i.test(ref)) return ref;
    if (ref.charAt(0) === "/") {
        var o = rdcOrigin(base);
        return o ? (o + ref) : ref;
    }
    var cut = base.lastIndexOf("/");
    return (cut === -1 ? base : base.slice(0, cut + 1)) + ref;
}

// Desescapa las barras/comillas que mete el payload RSC (\", \/, \u002f).
function rdcUnescape(s) {
    return String(s || "")
        .replace(/\\u002[fF]/g, "/")
        .replace(/\\\//g, "/")
        .replace(/\\"/g, '"');
}

// base64 -> string (solo ASCII; el JSON decodificado son URLs).
function rdcB64(str) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var s = String(str || "").replace(/[^A-Za-z0-9+/=]/g, "");
    while (s.length % 4 !== 0) s += "=";
    var out = "";
    for (var i = 0; i < s.length; i += 4) {
        var e1 = chars.indexOf(s.charAt(i));
        var e2 = chars.indexOf(s.charAt(i + 1));
        var e3 = chars.indexOf(s.charAt(i + 2));
        var e4 = chars.indexOf(s.charAt(i + 3));
        if (e1 < 0 || e2 < 0) break;
        out += String.fromCharCode((e1 << 2) | (e2 >> 4));
        if (e3 >= 0) out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
        if (e4 >= 0) out += String.fromCharCode(((e3 & 3) << 6) | e4);
    }
    return out;
}

function rdcGet(url, headers, tag) {
    try {
        var raw = nitro.fetchFull(url, "GET", null, JSON.stringify(headers || {}));
        if (!raw) {
            nitro.log("❓ [rdc] fetch null " + (tag || "") + " " + url.substring(0, 90));
            return null;
        }
        var j = JSON.parse(raw);
        var st = String(j.status);
        var body = j.body || "";
        nitro.log("📡 [rdc] " + (tag || "GET") + " status=" + st + " len=" + body.length);
        if (st !== "200") return null;
        return body;
    } catch (e) {
        nitro.log("❓ [rdc] fetch error " + (tag || "") + ": " + e);
        return null;
    }
}

function rdcGetRange(url, headers, bytes, tag, start) {
    var h = {};
    try {
        var src = typeof headers === "string" ? JSON.parse(headers || "{}") : (headers || {});
        for (var k in src) { if (src.hasOwnProperty(k)) h[k] = src[k]; }
    } catch (e) {}
    h["Range"] = "bytes=" + (start || 0) + "-" + bytes;
    try {
        var raw = nitro.fetchFull(url, "GET", null, JSON.stringify(h));
        if (!raw) return null;
        var j = JSON.parse(raw);
        var st = String(j.status);
        if (st !== "200" && st !== "206") {
            nitro.log("📡 [rdc] " + (tag || "RANGE") + " status=" + st + " (start=" + (start || 0) + ")");
            return null;
        }
        return j.body || "";
    } catch (e) {
        nitro.log("❓ [rdc] range error " + (tag || "") + ": " + e);
        return null;
    }
}

// Busca el 0x47 ('G') de sincronismo TS dentro de los primeros 188 bytes (offset del poliglota).
function rdcTsInside(body) {
    if (!body) return -1;
    for (var i = 0; i < 188 && i + 188 < body.length; i++) {
        if (body.charAt(i) === "G" && body.charAt(i + 188) === "G") return i;
    }
    return -1;
}

function rdcExtractEmbeds(html) {
    var out = [];
    var h = rdcUnescape(html);
    var re = /\{[^{}]{0,500}?"embed_url"\s*:\s*"([^"]+)"[^{}]{0,500}?\}/g;
    var m;
    while ((m = re.exec(h)) !== null) {
        var obj = m[0];
        var prov = obj.match(/"provider"\s*:\s*"([^"]*)"/);
        var qual = obj.match(/"quality"\s*:\s*"([^"]*)"/);
        out.push({
            url: m[1],
            provider: prov ? prov[1] : "",
            quality: qual ? qual[1] : ""
        });
    }
    if (out.length === 0) {
        var re2 = /"embed_url"\s*:\s*"([^"]+)"/g;
        while ((m = re2.exec(h)) !== null) out.push({ url: m[1], provider: "", quality: "" });
    }
    return out;
}

function rdcFirstIframe(html) {
    var m = String(html || "").match(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/i);
    return m ? m[1] : "";
}

function rdcDataC(html) {
    var m = String(html || "").match(/data-c\s*=\s*["']([^"']+)["']/i);
    if (m) return m[1];
    // fallback: blob base64 largo suelto en el HTML
    var m2 = String(html || "").match(/["']([A-Za-z0-9+/=]{200,})["']/);
    return m2 ? m2[1] : "";
}

// data-c = base64(reverse(json))
function rdcDecodeBlob(c) {
    try {
        var rev = String(c || "").split("").reverse().join("");
        var txt = rdcB64(rev);
        return JSON.parse(txt);
    } catch (e) {
        nitro.log("❌ [rdc] decode blob error: " + e);
        return null;
    }
}

// Valida un candidato HLS. Devuelve {ok:true, url:<m3u8>} (la variante si es master).
function rdcValidate(cand) {
    try {
        var url = cand.url;
        var headers = cand.headers;
        var chosenUrl = url;
        var segBase = url;

        var body = rdcGet(url, headers, "M3U8");
        if (!body) return { ok: false };
        if (body.indexOf("#EXTM3U") === -1) {
            nitro.log("⛔ [rdc] sin #EXTM3U");
            return { ok: false };
        }

        // Master: elegir la variante de mayor banda (aqui normalmente no hay master).
        if (body.indexOf("#EXT-X-STREAM-INF") !== -1) {
            var vBands = [];
            var re = /#EXT-X-STREAM-INF:([^\r\n]+)\r?\n([^\s#\r\n]+)/g;
            var vm;
            while ((vm = re.exec(body)) !== null) {
                var bm = vm[1].match(/BANDWIDTH=(\d+)/);
                vBands.push({ band: (bm ? parseInt(bm[1], 10) : 0), ref: vm[2] });
            }
            var best = null;
            for (var vi = vBands.length - 1; vi >= 0; vi--) {
                if (vBands[vi].band > 0 && vBands[vi].band <= 3000000) { best = vBands[vi]; break; }
            }
            if (!best && vBands.length) best = vBands[0];
            if (!best) return { ok: false };
            chosenUrl = rdcResolve(url, best.ref);
            segBase = chosenUrl;
            nitro.log("🎯 [rdc] variante band=" + best.band + " -> " + chosenUrl.substring(0, 100));
            var vb = rdcGet(chosenUrl, headers, "VARIANT");
            if (!vb || vb.indexOf("#EXTINF") === -1) {
                nitro.log("⛔ [rdc] variante sin EXTINF");
                return { ok: false };
            }
            body = vb;
        }

        if (body.indexOf("#EXTINF") === -1) {
            nitro.log("⛔ [rdc] playlist sin EXTINF");
            return { ok: false };
        }

        var lines = body.split(/\r?\n/);
        var segRef = "";
        for (var i = lines.length - 1; i >= 0; i--) {
            var L = lines[i].trim();
            if (!L || L.charAt(0) === "#") continue;
            segRef = L;
            break;
        }
        if (!segRef) return { ok: false };
        var segUrl = rdcResolve(segBase, segRef);

        var probe = rdcGetRange(segUrl, headers, 511, "SEG");
        if (!probe || probe.length === 0) {
            // sin probe no descartamos: el playlist ya es valido
            nitro.log("⚠️ [rdc] probe sin respuesta; se acepta el playlist");
            return { ok: true, url: chosenUrl };
        }
        if (probe.charAt(0) === "G") {
            nitro.log("✅ [rdc] segmento TS directo valido");
            return { ok: true, url: chosenUrl };
        }
        var off = rdcTsInside(probe);
        if (off >= 0) {
            nitro.log("✅ [rdc] poliglota PNG+TS valido (TS desde offset " + off + ")");
            return { ok: true, url: chosenUrl };
        }
        if (probe.indexOf("ftyp") !== -1) {
            nitro.log("✅ [rdc] segmento fMP4 valido");
            return { ok: true, url: chosenUrl };
        }
        nitro.log("⚠️ [rdc] probe no reconocido (char0=" + probe.charCodeAt(0) + "); se acepta el playlist");
        return { ok: true, url: chosenUrl };
    } catch (e) {
        nitro.log("❌ [rdc] validate error: " + e);
        return { ok: false };
    }
}

function rdcHeaders(referer) {
    return {
        "User-Agent": rdcUa(),
        "Referer": referer || "https://reidoscanais.im/",
        "Origin": rdcOrigin(referer || "https://reidoscanais.im/")
    };
}

// Resuelve UN embed: embed -> iframe -> data-c -> {url, headers} validado (o null).
async function rdcResolveEmbed(embedUrl, pageUrl, tag) {
    var eh = await rdcGetAsync(embedUrl, rdcHeaders(pageUrl), "EMBED" + tag);
    if (!eh) return null;

    var iframe = rdcFirstIframe(eh);
    if (!iframe) {
        nitro.log("⚠️ [rdc] embed" + tag + " sin iframe");
        return null;
    }
    iframe = rdcResolve(embedUrl, iframe);
    nitro.log("🖼️ [rdc] embed" + tag + " iframe=" + iframe);

    if (/\.m3u8(\?|$)/i.test(iframe)) {
        var direct = { url: iframe, headers: rdcHeaders(embedUrl) };
        var dv = rdcValidate(direct);
        return dv && dv.ok ? { url: dv.url, headers: direct.headers } : null;
    }

    var ph = await rdcGetAsync(iframe, rdcHeaders(embedUrl), "PLAYER" + tag);
    if (!ph) return null;

    var blob = rdcDataC(ph);
    if (!blob) {
        // ultimo recurso: m3u8 directo en el HTML del player
        var mm = ph.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
        if (mm) {
            var c0 = { url: mm[0].replace(/\\\//g, "/"), headers: rdcHeaders(iframe) };
            var v0 = rdcValidate(c0);
            return v0 && v0.ok ? { url: v0.url, headers: c0.headers } : null;
        }
        nitro.log("⚠️ [rdc] embed" + tag + " sin data-c");
        return null;
    }

    var json = rdcDecodeBlob(blob);
    if (!json || !json.u || !json.u.length) {
        nitro.log("⚠️ [rdc] embed" + tag + " blob sin urls");
        return null;
    }

    var headers = rdcHeaders(iframe + "/");
    for (var i = 0; i < json.u.length; i++) {
        var u = String(json.u[i]).replace(/\\\//g, "/");
        nitro.log("🎬 [rdc] embed" + tag + " candidato[" + i + "]: " + u.substring(0, 120));
        var cand = { url: u, headers: headers };
        var v = rdcValidate(cand);
        if (v && v.ok) {
            nitro.log("✅ [rdc] embed" + tag + " OK");
            return { url: v.url, headers: headers };
        }
    }

    // ninguno valido: devolver el primero (mejor esfuerzo)
    var first = String(json.u[0]).replace(/\\\//g, "/");
    nitro.log("⚠️ [rdc] embed" + tag + " ningun candidato valido; fallback al primero");
    return { url: first, headers: headers };
}

// wrapper async de rdcGet (para poder usar await)
async function rdcGetAsync(url, headers, tag) {
    return rdcGet(url, headers, tag);
}

async function extract(url) {
    nitro.log("🔍 [rdc] reidoscanais activado: " + url);

    var pageUrl = String(url || "").split("#")[0];
    var slug = "";
    var ms = pageUrl.match(/\/assistir\/([^\/?#]+)/i);
    if (ms) slug = ms[1];
    nitro.log("🎯 [rdc] slug=" + slug);

    var pageHtml = await rdcGetAsync(pageUrl, rdcHeaders("https://reidoscanais.im/"), "PAGE");
    if (!pageHtml) {
        nitro.log("❌ [rdc] pagina vacia");
        return null;
    }

    var embeds = rdcExtractEmbeds(pageHtml);
    if (embeds.length === 0) {
        var ifr = rdcFirstIframe(pageHtml);
        if (ifr) embeds.push({ url: rdcResolve(pageUrl, ifr), provider: "iframe", quality: "" });
    }
    nitro.log("🧩 [rdc] embeds encontrados: " + embeds.length);
    for (var i = 0; i < embeds.length; i++) {
        nitro.log("🧩 [rdc] embed[" + i + "] " + embeds[i].provider + " " + embeds[i].quality + " -> " + embeds[i].url);
    }
    if (embeds.length === 0) {
        nitro.log("❌ [rdc] sin embeds en la pagina");
        return null;
    }

    var limit = embeds.length > 4 ? 4 : embeds.length;
    for (var j = 0; j < limit; j++) {
        var r = await rdcResolveEmbed(embeds[j].url, pageUrl, "[" + j + "]");
        if (r && r.url) {
            nitro.log("✅ [rdc] URL final: " + r.url.substring(0, 140));
            return r;
        }
        nitro.log("⛔ [rdc] embed[" + j + "] sin resultado; siguiente...");
    }

    nitro.log("❌ [rdc] ningun embed dio un stream valido");
    return null;
}
