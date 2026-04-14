/**
 * [v55.18.0] Driver Nitro Cloud: Bysedikamoum (Ghost Browser Mode)
 * Este driver delega toda la carga al motor nativo WebView Interceptor
 * para bypass total de protecciones de bot.
 */
async function extract(url) {
    nitro.log("👻 Transformando URL para Acceso Directo Ghost...");
    
    // Transformamos bysedikamoum.com/e/ID -> 398fitus.com/e/ID
    const videoId = url.split('/').pop();
    const directPlayerUrl = `https://398fitus.com/e/${videoId}`;
    
    nitro.log(`🚀 Iniciando WebView en: ${directPlayerUrl}`);
    
    // Iniciamos la WebView directamente en el dominio del reproductor
    nitro.webViewExtract(directPlayerUrl);
    
    return { type: 'webview_mode' };
}
