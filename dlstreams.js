/**
 * Nitro Driver para dlstreams.st (DaddyLive / DLHD mirror)
 * Flujo: 
 *   URL canal (resolve_url) = https://dlstreams.st/watch/stream-{id}.php
 *   1º) La watch page embebe un iframe: https://{embedHost}.romponalis.st/premiumtv/daddy{N}.php?id={id}
 *   2º) El embed contiene:  source: window.atob('<base64>')
 *   3º) El base64 decodifica a:  https://xameleon.phantemlis.top/{word}/secure/{hash}/{ts}/premium{id}/index.m3u8
 *
 * El master .m3u8 EXIGE un Referer EXACTO del host del embed (probado: 403 sin él o con otro).
 * Los segmentos (.zst, pero en realidad MPEG-TS 0x47) NO piden referer.
 */

// Definir extract() para compatibilidad con motores que lo llaman correctamente
async function extract(url) {
    return await _dlstreams_extract(url);
}

async function _dlstreams_extract(url) {
    nitro.log("🔍 [DLStreams] Iniciando extracción para: " + url);

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    // 1. Obtener el host de la "watch page" (dlstreams.st) para el Referer del 1º fetch
    let watchHost = "dlstreams.st";
    try {
        const h = url.match(/https?:\/\/([^\/]+)/);
        if (h) watchHost = h[1];
    } catch(e) {}

    // 2. FETCH de la watch page para localizar el iframe del embed
    const pageJson = nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": UA,
        "Referer": "https://" + watchHost + "/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }));

    let pageHtml = "";
    try { pageHtml = JSON.parse(pageJson || "{}").body || ""; } catch(e) {}
    if (!pageHtml) { nitro.log("❌ [DLStreams] No se obtuvo la watch page"); nitro.onResult(JSON.stringify(null)); return null; }

    // 3. Extraer el iframe <iframe src="https://...romponalis.st/premiumtv/daddy{N}.php?id={id}">
    const iframeMatch = pageHtml.match(/<iframe[^>]*src=["']([^"']*romponalis\.st[^"']*|premiumtv\/daddy[^"']*)["']/i);
    let embedUrl = iframeMatch ? iframeMatch[1] : null;
    if (embedUrl && embedUrl.startsWith("//")) embedUrl = "https:" + embedUrl;
    if (!embedUrl) {
        // fallback: cualquier iframe .php?id=
        const anyIframe = pageHtml.match(/<iframe[^>]*src=["']([^"']+\.php\?id=\d+)["']/i);
        embedUrl = anyIframe ? anyIframe[1] : null;
    }
    if (!embedUrl) { nitro.log("⚠️ [DLStreams] No se encontró iframe de embed"); nitro.onResult(JSON.stringify(null)); return null; }
    nitro.log("🎯 [DLStreams] Embed iframe: " + embedUrl);

    // 4. Derivar el Referer EXACTO del embed host (el .m3u8 lo exige)
    let embedHost = "hamis.romponalis.st";
    try {
        const eh = embedUrl.match(/https?:\/\/([^\/]+)/);
        if (eh) embedHost = eh[1];
    } catch(e) {}
    const referer = "https://" + embedHost + "/";
    nitro.log("🎯 [DLStreams] Referer para el m3u8: " + referer);

    // 5. FETCH del embed (con Referer de la watch page)
    const embedJson = nitro.fetchFull(embedUrl, "GET", null, JSON.stringify({
        "User-Agent": UA,
        "Referer": "https://" + watchHost + "/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }));

    let embedHtml = "";
    try { embedHtml = JSON.parse(embedJson || "{}").body || ""; } catch(e) {}
    if (!embedHtml) { nitro.log("❌ [DLStreams] No se obtuvo el embed"); nitro.onResult(JSON.stringify(null)); return null; }

    // 6. Extraer el base64 de window.atob('...')   (comillas simples o dobles)
    let b64 = null;
    const b64Match = embedHtml.match(/atob\(["']([A-Za-z0-9+/=]+)["']\)/);
    if (b64Match) b64 = b64Match[1];
    if (!b64) { nitro.log("⚠️ [DLStreams] No se encontró base64 atob en el embed"); nitro.onResult(JSON.stringify(null)); return null; }

    // 7. Decodificar base64 -> m3u8
    // Usar atob + decodeURIComponent/escape (robusto en WebView, el m3u8 es ASCII).
    let m3u8Url = null;
    try {
        const bin = atob(b64);
        // decodificar latin1 a UTF-8 de forma manual (sin depender de TextDecoder) 
        try {
            m3u8Url = decodeURIComponent(escape(bin));
        } catch(e2) {
            // fallback: bin ya es ASCII
            m3u8Url = bin;
        }
    } catch(e) {
        nitro.log("❌ [DLStreams] Error decodificando base64: " + e.message);
    }
    if (!m3u8Url || !/^https?:/.test(m3u8Url)) {
        nitro.log("⚠️ [DLStreams] URL decodificada inválida: " + m3u8Url);
        nitro.onResult(JSON.stringify(null));
        return null;
    }
    nitro.log("🎯 [DLStreams] m3u8 obtenido: " + m3u8Url);

    // 8. Devolver URL + headers (Referer EXACTO del embed host)
    const result = {
        url: m3u8Url,
        headers: {
            "User-Agent": UA,
            "Referer": referer,
            "Origin": "https://" + embedHost
        }
    };
    nitro.log("✅ [DLStreams] Extracción exitosa, devolviendo con Referer");
    nitro.onResult(JSON.stringify(result));
    return result;
}

// AUTO-EJECUCIÓN (ver streamtp.js)
(function() {
    try {
        if (typeof __nitro_target_url !== 'undefined' && __nitro_target_url) {
            _dlstreams_extract(__nitro_target_url).catch(function(e) {
                nitro.log("❌ [DLStreams Auto] Error: " + e.message);
                nitro.onResult(JSON.stringify(null));
            });
        }
    } catch(e) {}
})();
