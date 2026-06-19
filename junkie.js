async function extract(url) {
    return new Promise((resolve, reject) => {
        try {
            nitro.log("Iniciando extraccion de JunkieEmbeds (via Iframe-SrcDoc + Clic Interno)...");
            
            // 1. Limpiar el cuerpo por si acaso
            document.body.innerHTML = '';

            // 2. Fetch HTML con cabeceras correctas
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
            
            // 3. Parchear HTML
            let baseUrl = "https://junkieembeds.pages.dev/";
            if (html.includes('<head>')) {
                html = html.replace('<head>', '<head><base href="' + baseUrl + '">');
            } else {
                html = '<base href="' + baseUrl + '">' + html;
            }
            
            // ELIMINAR EL SCRIPT MALICIOSO DE RAIZ
            html = html.replace(/disable-devtool/g, 'falso-archivo');

            // 4. Crear el Iframe
            let iframe = document.createElement('iframe');
            iframe.style.width = '100vw';
            iframe.style.height = '100vh';
            iframe.style.border = 'none';
            document.body.appendChild(iframe);

            // 5. Configurar el entorno DENTRO del Iframe ANTES de inyectar
            let idoc = iframe.contentDocument || iframe.contentWindow.document;
            let iwin = iframe.contentWindow;

            // Falsificar el Referrer DENTRO del iframe
            Object.defineProperty(idoc.constructor.prototype, 'referrer', {
                get: function() { return "https://timstreams.net/"; },
                configurable: true
            });

            // Silenciar la consola dentro del iframe por seguridad extra
            const noop = function(){};
            const fakeConsole = { log: noop, warn: noop, error: noop, info: noop, debug: noop, clear: noop };
            try {
                Object.defineProperty(iwin, 'console', {
                    value: Object.freeze(fakeConsole),
                    writable: false,
                    configurable: false
                });
            } catch(e) {
                iwin.console.log = noop;
            }

            // 6. Inyectar HTML en el Iframe
            idoc.open();
            idoc.write(html);
            idoc.close();
            
            nitro.log("HTML inyectado en IFRAME. Esperando JWPlayer...");

            // 7. Clic Reactivo DENTRO del Iframe (El clicker de Kotlin no alcanza aquí)
            let clickAttempts = 0;
            let clickTimer = setInterval(() => {
                try {
                    let playBtn = idoc.querySelector('.jw-display-icon-container') ||
                                  idoc.querySelector('.jw-video') ||
                                  idoc.querySelector('video') ||
                                  idoc.querySelector('div[role="button"]') ||
                                  idoc.querySelector('button');
                    
                    if (playBtn) {
                        nitro.log("👉 ¡Botón detectado en el Iframe! Simulando clic...");
                        playBtn.click();
                        clearInterval(clickTimer);
                    }
                } catch(e) {}
                if (++clickAttempts > 150) clearInterval(clickTimer); // Timeout a los 30 seg
            }, 200);

            // 8. Timeout
            setTimeout(() => {
                reject("Timeout: No se detectó M3U8 en JunkieEmbeds");
            }, 30000);
            
        } catch(e) {
            reject(e.message);
        }
    });
}
