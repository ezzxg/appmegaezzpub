async function extract(url) {
    return new Promise((resolve, reject) => {
        try {
            nitro.log("Iniciando extraccion de StreamFree (API Interna)...");
            
            // 1. Extraer ID del partido de la URL
            // Ejemplo: https://streamfree.app/embed/soccer/australia-vs-united-states?quality=2160P
            let urlObj = new URL(url);
            let pathParts = urlObj.pathname.split('/'); 
            let matchId = pathParts[pathParts.length - 1]; // australia-vs-united-states
            
            let quality = urlObj.searchParams.get("quality");
            if (quality) {
                quality = quality.toLowerCase(); // 2160p, 1080p, etc.
            } else {
                quality = "720p";
            }
            
            let baseUrl = urlObj.origin; // https://streamfree.app

            let headers = JSON.stringify({
                "Referer": baseUrl + "/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            });
            
            // 2. Descargar el HTML para extraer el diccionario de tokens (_0x)
            let responseStr = nitro.fetchFull(url, "GET", null, headers);
            let html = JSON.parse(responseStr).body;
            
            if (!html) {
                nitro.log("No se pudo obtener el HTML. Usando WebView...");
                nitro.webViewExtract(url);
                return;
            }
            
            let tokens = {};
            let match = html.match(/const _0x\s*=\s*(\{.*?\});/);
            if (match) {
                tokens = JSON.parse(match[1]);
            } else {
                nitro.log("No se encontraron los tokens en el HTML. Usando WebView...");
                nitro.webViewExtract(url);
                return;
            }
            
            // 3. Obtener el stream key API
            let serverParam = urlObj.searchParams.get('server');
            let apiUrl = baseUrl + "/get-stream-key/" + matchId;
            if (serverParam) {
                apiUrl += "?force_server=" + encodeURIComponent(serverParam);
            }
            
            let apiRespStr = nitro.fetchFull(apiUrl, "GET", null, headers);
            let apiResp = JSON.parse(JSON.parse(apiRespStr).body);
            
            if (apiResp.is_external && apiResp.external_url) {
                nitro.log("Stream externo encontrado.");
                return resolve(apiResp.external_url);
            }
            
            let serverName = apiResp.server_name || 'origin';
            
            // 4. Construir la URL final del M3U8
            let m3u8Url = "";
            if (serverName !== 'origin') {
                m3u8Url = baseUrl + `/live-cdn/${matchId}${quality}/index.m3u8`;
            } else {
                m3u8Url = baseUrl + `/live/${matchId}${quality}/index.m3u8`;
            }
            
            let p = tokens[quality];
            if (p && p._t && p._e && p._n) {
                m3u8Url += `?_t=${p._t}&_e=${p._e}&_n=${p._n}`;
                nitro.log("URL M3U8 construida con exito.");
                resolve(m3u8Url);
            } else {
                // Si el token para la calidad no existe, forzamos WebView
                nitro.log("Token para la calidad no encontrado. Usando WebView...");
                nitro.webViewExtract(url);
            }
            
        } catch(e) {
            nitro.log("Error en extractor StreamFree: " + e.message + ". Cayendo a WebView...");
            nitro.webViewExtract(url);
        }
    });
}
