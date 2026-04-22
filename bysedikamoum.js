/**
 * [v55.120] Driver Nitro Cloud: Bysedikamoum (Optimized)
 * Implementa detección temprana de 404 vía API antes de lanzar el WebView.
 */
async function extract(url) {
    try {
        const videoCode = url.split("/e/")[1] || url.split("/").pop();
        const detailsUrl = "https://bysedikamoum.com/api/videos/" + videoCode + "/embed/details";
        
        nitro.log("🔍 Verificando integridad del link en Bysedikamoum...");
        
        // El motor local devolverá "ERROR_404" si el servidor responde 404
        const details = nitro.fetch(detailsUrl);
        
        if (details === "ERROR_404" || !details || details.includes("not_found")) {
            nitro.log("🚫 API reportó video inexistente.");
            nitro.onError("404: Video no encontrado");
            return null;
        }

        nitro.log("🌐 Link verificado. Activando modo WebView...");
        nitro.webViewExtract(url);
        return { type: 'webview_mode' };
        
    } catch (e) {
        nitro.log("🚫 Abortando por error: " + e);
        nitro.onError("404: Video no encontrado");
        return null;
    }
}
