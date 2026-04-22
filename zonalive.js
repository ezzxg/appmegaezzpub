/**
 * [v55.120] Driver Nitro Cloud: ZonaLive
 * Basado en OBSTREAM (eveningbad.net). Requiere Referer estricto.
 */
async function extract(url) {
    nitro.log("🌐 Iniciando extracción de ZonaLive...");
    
    // 1. Extraer ID del canal desde la URL
    const channelId = url.split("/").pop();
    nitro.log("📺 Canal ID: " + channelId);

    // 2. Activamos el WebView Interceptor
    // Este servidor usa Clappr + P2P Media Loader y tokens de sesión dinámicos.
    // El motor de la App capturará el m3u8 automáticamente.
    nitro.webViewExtract(url);

    // Devolvemos el modo webview con los headers necesarios para el reproductor
    return { 
        type: 'webview_mode',
        headers: {
            "Referer": "https://zonalive.click/",
            "Origin": "https://zonalive.click",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
    };
}
