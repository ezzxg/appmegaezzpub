/**
 * [v55.123] Driver Nitro Cloud: LPFPLAY.COM (Traffic Mode)
 * Activa el Ghost Browser para capturar el master.m3u8 con tokens dinámicos.
 */
async function extract(url) {
    nitro.log("👻 LPF Play: Activando Modo Tráfico (Ghost Browser)...");
    
    // 1. Registrar las cabeceras que el interceptor debe usar al capturar el m3u8
    nitro.onResult(JSON.stringify({
        url: null, // Se capturará del tráfico
        headers: {
            "Referer": "https://www.lpfplay.com/",
            "Origin": "https://www.lpfplay.com",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
    }));

    // 2. Activar el motor de tráfico (WebView invisible)
    // El motor de la app cargará la URL de lpfplay y el interceptor nativo
    // capturará cualquier .m3u8 (como el master.m3u8 de Immergo)
    nitro.webViewExtract(url);
    
    // 3. Notificar al motor que hemos pasado a modo WebView
    return { type: 'webview_mode' };
}
