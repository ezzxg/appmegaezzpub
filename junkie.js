async function extract(url) {
    return new Promise((resolve, reject) => {
        try {
            nitro.log("Iniciando extraccion de JunkieEmbeds (via Fetch+Write con Console Hack)...");
            
            // 1. Deshabilitar y congelar la consola
            // disable-devtool lanza trampas a la consola. En WebView, el WebChromeClient 
            // serializa los objetos, disparando los getters y activando el bucle infinito.
            // Si anulamos la consola, disable-devtool creerá que está cerrada.
            const noop = function(){};
            const fakeConsole = {
                log: noop, warn: noop, error: noop, info: noop,
                debug: noop, dir: noop, clear: noop, table: noop,
                profile: noop, profileEnd: noop, count: noop,
                time: noop, timeEnd: noop, trace: noop, group: noop,
                groupEnd: noop, groupCollapsed: noop
            };
            
            try {
                Object.defineProperty(window, 'console', {
                    value: Object.freeze(fakeConsole),
                    writable: false,
                    configurable: false
                });
            } catch(e) {
                // Si no se puede redefinir toda la consola, anulamos sus métodos
                window.console.log = noop;
                window.console.warn = noop;
                window.console.error = noop;
                window.console.info = noop;
                window.console.dir = noop;
                window.console.clear = noop;
            }

            // 2. Definir referer falso en el prototipo del Documento
            Object.defineProperty(Document.prototype, 'referrer', {
                get: function() { return "https://timstreams.net/"; },
                configurable: true
            });

            // 3. Fetch HTML con cabeceras correctas
            let headers = JSON.stringify({
                "Referer": "https://timstreams.net/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            });
            
            let responseStr = nitro.fetchFull(url, "GET", null, headers);
            let response;
            try {
                response = JSON.parse(responseStr);
            } catch (e) {
                return reject("Fallo al parsear respuesta: " + responseStr);
            }
            
            if (response.status !== 200) {
                return reject("Error cargando HTML: " + response.status);
            }
            
            let html = response.body;
            if (!html) return reject("El HTML descargado esta vacio.");
            
            // 4. Parchear HTML
            let baseUrl = "https://junkieembeds.pages.dev/";
            if (html.includes('<head>')) {
                html = html.replace('<head>', '<head><base href="' + baseUrl + '">');
            } else {
                html = '<base href="' + baseUrl + '">' + html;
            }
            
            // Forzar a la pagina a creer que es un Iframe 
            html = html.replace(/window\.self\s*!==\s*window\.top/g, 'true');
            html = html.replace(/window\.self\s*===\s*window\.top/g, 'false');

            // 5. Inyectar HTML parcheado
            document.open();
            document.write(html);
            document.close();
            
            nitro.log("HTML inyectado y parcheado. Consola silenciada. Esperando M3U8...");

            // 6. Timeout
            setTimeout(() => {
                reject("Timeout: No se detectó M3U8 en JunkieEmbeds");
            }, 30000);
            
        } catch(e) {
            reject(e.message);
        }
    });
}
