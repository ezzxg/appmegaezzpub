/**
 * [v55.120] Driver Nitro Cloud: ZonaLive (Manual Cloud Mode)
 * Este driver NO usa WebView; extrae el link directamente para saltar el limitador de la App.
 */
async function extract(url) {
    nitro.log("🔍 Iniciando Extracción Manual Cloud para ZonaLive...");
    
    // 1. Obtener el HTML de la página del player
    const html = nitro.fetch(url);
    if (!html) {
        nitro.log("❌ No se pudo obtener el HTML de ZonaLive");
        return null;
    }

    // 2. Buscar el iframe de OBStream (eveningbad.net)
    const iframeMatch = html.match(/iframe.*?src=["']([^"']*eveningbad\.net[^"']*)["']/i);
    if (!iframeMatch) {
        nitro.log("❌ No se encontró el iframe de OBStream en el HTML");
        return null;
    }
    
    const iframeUrl = iframeMatch[1];
    nitro.log("🔗 Iframe detectado: " + iframeUrl);

    // 3. Entrar al iframe para buscar el m3u8
    // Usamos el Referer de zonalive para que nos deje entrar al iframe
    const iframeHtml = nitro.fetch(iframeUrl, JSON.stringify({ 
        "Referer": "https://zonalive.click/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }));
    
    if (!iframeHtml) {
        nitro.log("❌ No se pudo obtener el HTML del Iframe");
        return null;
    }

    // 4. Buscar el m3u8 en el código del reproductor
    // Buscamos patrones comunes de file: o source:
    const m3u8Match = iframeHtml.match(/file\s*:\s*["']([^"']*\.m3u8[^"']*)["']/i) || 
                      iframeHtml.match(/source\s*:\s*["']([^"']*\.m3u8[^"']*)["']/i) ||
                      iframeHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
                      
    if (m3u8Match) {
        const finalStream = m3u8Match[1].replace(/\\\//g, "/");
        nitro.log("🎯 m3u8 encontrado manualmente: " + finalStream);
        
        // DEVOLVEMOS EL RESULTADO DIRECTO
        // Esto hace que la App use estos headers obligatoriamente
        return {
            url: finalStream,
            headers: {
                "Referer": "https://eveningbad.net/",
                "Origin": "https://eveningbad.net",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }
        };
    }

    nitro.log("⚠️ No se encontró m3u8 directo en el código. Fallback...");
    return null;
}
