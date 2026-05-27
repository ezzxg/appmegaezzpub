/**
 * [v55.141] Driver Nitro Cloud: UNIVERSAL STRUCTURAL EXTRACTOR
 * Detecta automáticamente cualquier sitio basado en el motor Next.js/vestData.
 * No requiere registrar dominios manualmente.
 */
async function extract(url) {
    try {
        const UA = "Mozilla/5.0 (Linux; Android 9; PJH110 Build/PQ3A.190705.09121607) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Safari/537.36 buscari/115";
        
        nitro.log("🚀 Nitro Universal: Extrayendo desde " + url);
        
        // Obtener el origen dinámicamente para el Referer
        const origin = new URL(url).origin + "/";
        
        // Fetch de la página con el UA obligatorio
        const pageContent = nitro.fetch(url, JSON.stringify({
            "User-Agent": UA
        }));

        if (!pageContent || pageContent.includes("Cloudflare")) {
            nitro.log("🚫 Bloqueo de Cloudflare o contenido vacío.");
            return null;
        }

        // Extraer __NEXT_DATA__
        const regexNextData = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
        const match = pageContent.match(regexNextData);
        
        if (!match) {
            nitro.log("🚫 No se encontró __NEXT_DATA__.");
            return null;
        }

        const data = JSON.parse(match[1]);
        let m3u8Url = null;

        // Intento 1: Ruta estándar
        try {
            const mediaInfo = data.props.pageProps.mediaInfoList;
            if (mediaInfo && mediaInfo.length > 0) {
                m3u8Url = mediaInfo[0].mediaUrl;
            }
        } catch(e) {}

        // Intento 2: Búsqueda profunda si falló la ruta estándar
        if (!m3u8Url) {
            nitro.log("⚠️ Ruta estándar falló, intentando búsqueda profunda...");
            const jsonStr = match[1];
            const m3u8Match = jsonStr.match(/https?:\/\/[^"]+?\.m3u8[^"]*/);
            if (m3u8Match) {
                m3u8Url = m3u8Match[0].replace(/\\u0026/g, '&');
            }
        }

        if (!m3u8Url) {
            nitro.log("🚫 No se encontró ningún enlace m3u8 en los datos.");
            return null;
        }

        nitro.log("🎯 M3U8 capturado: " + m3u8Url);

        return {
            url: m3u8Url,
            headers: {
                "User-Agent": UA,
                "Referer": origin
            }
        };

    } catch (e) {
        nitro.log("🚫 Error en Extractor Universal: " + e.message);
        return null;
    }
}
