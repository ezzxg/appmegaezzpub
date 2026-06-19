async function extract(url) {
    return new Promise((resolve, reject) => {
        try {
            nitro.log("Iniciando extraccion de JunkieEmbeds (via Fetch+Write con Interceptor de Propiedades)...");
            
            // 1. Definir referer falso en el prototipo del Documento
            Object.defineProperty(Document.prototype, 'referrer', {
                get: function() { return "https://timstreams.net/"; },
                configurable: true
            });

            // 2. Interceptar HTMLScriptElement.prototype.src para anular 'disable-devtool'
            const origSrcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
            Object.defineProperty(HTMLScriptElement.prototype, 'src', {
                set: function(val) {
                    if (val && val.includes('disable-devtool')) {
                        nitro.log("🚫 Script malicioso bloqueado en el Setter: " + val);
                        val = 'about:blank';
                    }
                    if (origSrcDesc && origSrcDesc.set) {
                        origSrcDesc.set.call(this, val);
                    }
                },
                get: function() {
                    if (origSrcDesc && origSrcDesc.get) return origSrcDesc.get.call(this);
                    return this.getAttribute('src');
                }
            });

            // Interceptar también setAttribute por si usan script.setAttribute('src', ...)
            const origSetAttribute = Element.prototype.setAttribute;
            Element.prototype.setAttribute = function(name, value) {
                if (this.tagName === 'SCRIPT' && name.toLowerCase() === 'src' && value && value.includes('disable-devtool')) {
                    nitro.log("🚫 Script malicioso bloqueado en setAttribute: " + value);
                    value = 'about:blank';
                }
                return origSetAttribute.call(this, name, value);
            };

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
            
            nitro.log("HTML inyectado y parcheado. Esperando M3U8...");

            // 6. Timeout
            setTimeout(() => {
                reject("Timeout: No se detectó M3U8 en JunkieEmbeds");
            }, 30000);
            
        } catch(e) {
            reject(e.message);
        }
    });
}
