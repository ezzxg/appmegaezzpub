/**
 * [v55.18.0] Driver Nitro Cloud: Bysedikamoum (Ghost Browser Mode)
 * Este driver delega toda la carga al motor nativo WebView Interceptor
 * para bypass total de protecciones de bot.
 */
async function extract(url) {
    nitro.log("👻 Activando Ghost Browser para Bysedikamoum...");
    
    // Indicamos al motor que inicie la carga real en la WebView
    nitro.webViewExtract(url);
    
    // Devolvemos el flag para que el motor sepa que debe esperar la interceptación
    return { type: 'webview_mode' };
}
