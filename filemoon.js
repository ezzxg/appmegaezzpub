/**
 * [v55.122] Driver Nitro Cloud: FILEMOON.SX (Traffic Mode)
 * No scrapea; activa el Ghost Browser para capturar el tráfico real.
 */
async function extract(url) {
    nitro.log("👻 Filemoon: Activando Modo Tráfico (Ghost Browser)...");
    
    // 1. Registrar las cabeceras que el interceptor debe usar al capturar el m3u8
    // Esto asegura que el m3u8 se capture con el Referer correcto
    nitro.onResult(JSON.stringify({
        url: null, // No tenemos la URL todavía
        headers: {
            "Referer": url,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Origin": "https://filemoon.sx"
        }
    }));

    // 2. Activar el motor de tráfico (WebView invisible)
    // El motor de la app cargará la URL, simulará el click y capturará el m3u8 del tráfico
    nitro.webViewExtract(url);
    
    // 3. Notificar al motor que hemos pasado a modo WebView
    return { type: 'webview_mode' };
}
