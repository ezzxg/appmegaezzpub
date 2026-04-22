/**
 * [v55.120] Driver Nitro Cloud: ZonaLive
 * Basado en OBSTREAM (eveningbad.net). 
 * IMPORTANTE: Requiere headers de eveningbad.net para evitar 404 en el m3u8.
 */
async function extract(url) {
    nitro.log("🌐 Iniciando extracción de ZonaLive...");
    
    // 1. Extraer ID del canal desde la URL
    const channelId = url.split("/").pop();
    nitro.log("📺 Canal ID: " + channelId);

    // 2. Activamos el WebView Interceptor
    // Usamos la URL original, el motor capturará el m3u8.
    nitro.webViewExtract(url);

    // Devolvemos los headers que el usuario especificó para que el reproductor (ExoPlayer) pueda abrir el stream
    return { 
        type: 'webview_mode',
        headers: {
            "Referer": "https://eveningbad.net/",
            "Origin": "https://eveningbad.net",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
    };
}
