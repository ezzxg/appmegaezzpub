/**
 * [v55.139] Driver Nitro Cloud: 321MoviesFree (Universal Next.js)
 * Extrae m3u8 directamente de los datos JSON __NEXT_DATA__.
 * Requiere User-Agent específico para el bypass inicial.
 */
async function extract(url) {
    try {
        const UA = "Mozilla/5.0 (Linux; Android 9; PJH110 Build/PQ3A.190705.09121607) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Safari/537.36 buscari/115";
        
        nitro.log("🔍 Extrayendo desde 321MoviesFree...");
        
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
        const mediaInfo = data.props.pageProps.mediaInfoList;

        if (!mediaInfo || mediaInfo.length === 0) {
            nitro.log("🚫 No hay mediaInfoList en los metadatos.");
            return null;
        }

        // Buscamos la mejor calidad (generalmente el primero o el SD/HD)
        const bestSource = mediaInfo[0]; // GROOT_SD suele ser el primero
        const m3u8Url = bestSource.mediaUrl;

        nitro.log("🎯 M3U8 capturado: " + m3u8Url);

        return {
            url: m3u8Url,
            headers: {
                "User-Agent": UA,
                "Referer": "https://ww20.321moviesfree.com/"
            }
        };

    } catch (e) {
        nitro.log("🚫 Error en 321Movies: " + e.message);
        return null;
    }
}
