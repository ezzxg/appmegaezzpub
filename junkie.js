async function extract(url) {
    return new Promise((resolve, reject) => {
        try {
            nitro.log("Iniciando extraccion de JunkieEmbeds (via Iframe-SrcDoc + Jwplayer API)...");
            
            document.body.innerHTML = '';

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
            
            let baseUrl = "https://junkieembeds.pages.dev/";
            if (html.includes('<head>')) {
                html = html.replace('<head>', '<head><base href="' + baseUrl + '">');
            } else {
                html = '<base href="' + baseUrl + '">' + html;
            }
            
            // ELIMINAR EL SCRIPT MALICIOSO
            html = html.replace(/disable-devtool/g, 'falso-archivo');
            
            // Falsificar variables de location por si el script ofuscado las usa
            html = html.replace(/window\.location\.hostname/g, '"junkieembeds.pages.dev"');
            html = html.replace(/location\.hostname/g, '"junkieembeds.pages.dev"');
            html = html.replace(/window\.location\.href/g, '"https://junkieembeds.pages.dev/embed/fusballtvuhd-de"');

            let iframe = document.createElement('iframe');
            iframe.style.width = '100vw';
            iframe.style.height = '100vh';
            iframe.style.border = 'none';
            document.body.appendChild(iframe);

            let idoc = iframe.contentDocument || iframe.contentWindow.document;
            let iwin = iframe.contentWindow;

            Object.defineProperty(idoc.constructor.prototype, 'referrer', {
                get: function() { return "https://timstreams.net/"; },
                configurable: true
            });

            const noop = function(){};
            // Capturamos los errores del iframe para ver por qué falla
            const fakeConsole = { 
                log: noop, 
                warn: function(msg){ nitro.log("IFRAME WARN: " + msg); }, 
                error: function(msg){ nitro.log("IFRAME ERROR: " + msg); }, 
                info: noop, debug: noop, clear: noop 
            };
            try {
                Object.defineProperty(iwin, 'console', { value: Object.freeze(fakeConsole), writable: false, configurable: false });
            } catch(e) {
                iwin.console.log = noop;
            }

            idoc.open();
            idoc.write(html);
            idoc.close();
            
            nitro.log("HTML inyectado en IFRAME. Buscando JWPlayer...");

            let clickAttempts = 0;
            let clickTimer = setInterval(() => {
                let idocNow = iframe.contentDocument || iframe.contentWindow.document;
                let iwinNow = iframe.contentWindow;
                
                // Intento 1: API de JWPlayer (Más rápido y seguro que el clic físico)
                try {
                    if (iwinNow.jwplayer && typeof iwinNow.jwplayer === 'function') {
                        let player = iwinNow.jwplayer();
                        if (player && player.getState) {
                            let state = player.getState();
                            if (state === 'idle' || state === 'paused') {
                                nitro.log("👉 JWPlayer detectado por API! Forzando Play...");
                                player.play();
                                clearInterval(clickTimer);
                                return;
                            }
                        }
                    }
                } catch(e) {}
                
                // Intento 2: Clic físico
                try {
                    let playBtn = idocNow.querySelector('.jw-display-icon-container') ||
                                  idocNow.querySelector('.jw-video');
                    if (playBtn) {
                        nitro.log("👉 Botón físico detectado! Simulando clic...");
                        playBtn.click();
                        clearInterval(clickTimer);
                        return;
                    }
                } catch(e) {}
                
                if (++clickAttempts > 50) { // 10 segundos max
                    clearInterval(clickTimer);
                }
            }, 200);

            // Timeout interno
            setTimeout(() => {
                reject("Timeout Interno: No se generó el M3U8");
            }, 30000);
            
        } catch(e) {
            reject(e.message);
        }
    });
}
