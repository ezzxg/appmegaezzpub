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

    // id del canal (para construir el embed directo)
    let channelId = null;
    try {
        const im = url.match(/[?&]id=(\d+)/) || url.match(/(\d+)\.php/);
        if (im) channelId = im[1];
    } catch(e) {}

    // 2. VÍA RÁPIDA: probar el embed DIRECTAMENTE (ahorra la watch page de 640KB, ~5-6s)
    //    El host del embed es estable (hamis.romponalis.st) y daddy/daddy4/daddy5
    //    responden para cualquier id. Si uno tiene base64 válido, listo.
    const EMBED_HOST = "hamis.romponalis.st";
    const referer = "https://" + EMBED_HOST + "/";
    let embedHtml = "";
    if (channelId) {
        var variants = ["daddy4", "daddy", "daddy5"];
        for (var vi = 0; vi < variants.length; vi++) {
            var embedUrl = "https://" + EMBED_HOST + "/premiumtv/" + variants[vi] + ".php?id=" + channelId;
            var embedJson = nitro.fetchFull(embedUrl, "GET", null, JSON.stringify({
                "User-Agent": UA,
                "Referer": "https://" + watchHost + "/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            }));
            var tmpHtml = "";
            try { tmpHtml = JSON.parse(embedJson || "{}").body || ""; } catch(e) {}
            if (tmpHtml && /atob\(["']([A-Za-z0-9+/=]+)["']\)/.test(tmpHtml)) {
                embedHtml = tmpHtml;
                nitro.log("🎯 [DLStreams] Vía rápida: embed directo " + variants[vi] + ".php?id=" + channelId);
                break;
            }
        }
    }

    // 3. FALLBACK: si la vía rápida no dio, leer la watch page para localizar el iframe
    if (!embedHtml) {
        nitro.log("⚠️ [DLStreams] Vía rápida sin éxito, leyendo watch page...");
        const pageJson = nitro.fetchFull(url, "GET", null, JSON.stringify({
            "User-Agent": UA,
            "Referer": "https://" + watchHost + "/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }));
        let pageHtml = "";
        try { pageHtml = JSON.parse(pageJson || "{}").body || ""; } catch(e) {}
        if (!pageHtml) { nitro.log("❌ [DLStreams] No se obtuvo la watch page"); nitro.onResult(JSON.stringify(null)); return null; }
        const iframeMatch = pageHtml.match(/<iframe[^>]*src=["']([^"']*romponalis\.st[^"']*|premiumtv\/daddy[^"']*)["']/i);
        let iframeUrl = iframeMatch ? iframeMatch[1] : null;
        if (iframeUrl && iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
        if (!iframeUrl) {
            const anyIframe = pageHtml.match(/<iframe[^>]*src=["']([^"']+\.php\?id=\d+)["']/i);
            iframeUrl = anyIframe ? anyIframe[1] : null;
        }
        if (!iframeUrl) { nitro.log("⚠️ [DLStreams] No se encontró iframe de embed"); nitro.onResult(JSON.stringify(null)); return null; }
        const embedJson = nitro.fetchFull(iframeUrl, "GET", null, JSON.stringify({
            "User-Agent": UA,
            "Referer": "https://" + watchHost + "/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }));
        try { embedHtml = JSON.parse(embedJson || "{}").body || ""; } catch(e) {}
    }
    if (!embedHtml) { nitro.log("❌ [DLStreams] No se obtuvo el embed"); nitro.onResult(JSON.stringify(null)); return null; }

    // 4. Extraer el base64 de window.atob('...')   (comillas simples o dobles)
    let b64 = null;
    const b64Match = embedHtml.match(/atob\(["']([A-Za-z0-9+/=]+)["']\)/);
    if (b64Match) b64 = b64Match[1];
    if (!b64) { nitro.log("⚠️ [DLStreams] No se encontró base64 atob en el embed"); nitro.onResult(JSON.stringify(null)); return null; }

    // 5. Decodificar base64 -> m3u8
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

    // 6. Devolver URL + headers (Referer EXACTO del embed host)
    const result = {
        url: m3u8Url,
        headers: {
            "User-Agent": UA,
            "Referer": referer,
            "Origin": "https://" + EMBED_HOST
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
