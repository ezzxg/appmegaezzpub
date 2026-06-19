async function extract(url) {
    return new Promise((resolve, reject) => {
        try {
            nitro.log("Iniciando extraccion de JunkieEmbeds (via Iframe)...");
            
            // Limpiar el body del WebView
            document.body.innerHTML = '';
            document.body.style.backgroundColor = 'black';
            document.body.style.margin = '0';
            document.body.style.padding = '0';
            
            // Crear un iframe para evadir la comprobación 'window.self === window.top'
            // de junkieembeds. Al estar en un iframe, isIframed sera true.
            let iframe = document.createElement('iframe');
            iframe.style.width = "100%";
            iframe.style.height = "100%";
            iframe.style.border = "none";
            iframe.setAttribute("allowfullscreen", "true");
            iframe.src = url;
            
            document.body.appendChild(iframe);
            
            nitro.log("Iframe inyectado. Esperando resolucion nativa del WebView (.m3u8)...");
            
            // No necesitamos hacer resolve() aqui porque NitroScriptEngine capturará 
            // el .m3u8 directamente a traves de 'shouldInterceptRequest' 
            // cuando el iframe comience la reproduccion.
            
            // Timeout de seguridad en caso de que no cargue nada
            setTimeout(() => {
                reject("Timeout: No se detectó M3U8 en JunkieEmbeds");
            }, 30000);
            
        } catch(e) {
            reject(e.message);
        }
    });
}
