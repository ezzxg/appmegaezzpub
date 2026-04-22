/**
 * [v55.120] Driver Nitro Cloud: ZonaLive (Session-Aware Mode)
 * Extrae m3u8 y CAPTURA la cookie de sesión para que el reproductor no sea rechazado.
 */
async function extract(url) {
    nitro.log("🔍 Iniciando Extracción con Cookies para ZonaLive...");
    
    // 1. Obtener el HTML de la página del player
    const html = nitro.fetch(url);
    if (!html) {
        nitro.log("❌ No se pudo obtener el HTML de ZonaLive");
        return null;
    }

    // 2. Buscar el iframe de OBStream (eveningbad.net)
    const iframeMatch = html.match(/iframe.*?src=["']([^"']*eveningbad\.net[^"']*)["']/i);
    if (!iframeMatch) {
        nitro.log("❌ No se encontró el iframe de OBStream");
        return null;
    }
    
    const iframeUrl = iframeMatch[1];
    nitro.log("🔗 Iframe detectado: " + iframeUrl);

    // 3. Entrar al iframe usando fetchFull para capturar Cookies
    const responseJson = nitro.fetchFull(iframeUrl, "GET", null, JSON.stringify({ 
        "Referer": "https://zonalive.click/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }));
    
    const response = JSON.parse(responseJson);
    if (!response || !response.body) {
        nitro.log("❌ Error en la respuesta del Iframe");
        return null;
    }

    // 4. Buscar el m3u8
    const m3u8Match = response.body.match(/file\s*:\s*["']([^"']*\.m3u8[^"']*)["']/i) || 
                      response.body.match(/source\s*:\s*["']([^"']*\.m3u8[^"']*)["']/i) ||
                      response.body.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
    
    // 5. Capturar Cookies de sesión (Set-Cookie)
    // El motor Nitro v55.120 ya las extrae automáticamente en fetchFull
    const cookies = response.headers ? (response.headers["Set-Cookie"] || response.headers["set-cookie"] || "") : "";

    if (m3u8Match) {
        const finalStream = m3u8Match[1].replace(/\\\//g, "/");
        nitro.log("🎯 m3u8 + Cookies capturados. Enviando al reproductor...");
        
        return {
            url: finalStream,
            headers: {
                "Referer": "https://eveningbad.net/",
                "Origin": "https://eveningbad.net",
                "Cookie": cookies,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        };
    }

    nitro.log("⚠️ No se encontró m3u8 en el cuerpo del iframe.");
    return null;
}
