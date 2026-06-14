async function extract(url) {
    return new Promise((resolve, reject) => {
        try {
            let html = nitro.fetch(url);
            if (!html) return reject("Error obteniendo HTML");
            
            let baseTag = "<base href='https://junkieembeds.pages.dev/'>";
            if (html.includes("<head>")) html = html.replace("<head>", "<head>" + baseTag);
            else html = baseTag + html;
            
            // SÚPER PARCHE: Al usar document.write, los eventos "load" y "DOMContentLoaded" 
            // se pierden porque la página ya cargó. El reproductor JWPlayer (y blast.js) 
            // se quedan esperando infinitamente ese evento y por eso la app se cuelga en tag.min.js.
            let eventFixer = `
            <script>
                // Autoejecutar inmediatamente cualquier script que esté esperando el evento 'load'
                const origWinAdd = window.addEventListener;
                window.addEventListener = function(type, listener, opts) {
                    if (type === 'load' || type === 'DOMContentLoaded') {
                        setTimeout(listener, 500); // Dispararlo artificialmente
                    }
                    return origWinAdd.call(this, type, listener, opts);
                };
                const origDocAdd = document.addEventListener;
                document.addEventListener = function(type, listener, opts) {
                    if (type === 'load' || type === 'DOMContentLoaded') {
                        setTimeout(listener, 500);
                    }
                    return origDocAdd.call(this, type, listener, opts);
                };
                
                // Bloquear el script de ads (jnbhi.com) de raíz para que no congele el WebView
                const origCreate = document.createElement;
                document.createElement = function(tag) {
                    const el = origCreate.call(document, tag);
                    if (tag.toLowerCase() === 'script') {
                        Object.defineProperty(el, 'src', {
                            set: function(val) {
                                if (val && val.includes('jnbhi.com')) return; // IGNORAR AD
                                this.setAttribute('src', val);
                            },
                            get: function() { return this.getAttribute('src'); }
                        });
                    }
                    return el;
                };
            </script>`;
            html = html.replace("<head>", "<head>" + eventFixer);
            
            // Borrar botón trampa
            html = html.replace(/<div id="embedBtn"[^>]*>[\s\S]*?<\/div>/g, "");
            html = html.replace(/<div id="embedModal"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g, "");
            
            document.open();
            document.write(html);
            document.close();
            
            // Disparar los eventos estándar por si acaso usan handlers clásicos
            setTimeout(() => {
                try { document.dispatchEvent(new Event('DOMContentLoaded', {bubbles: true})); } catch(e){}
                try { window.dispatchEvent(new Event('load', {bubbles: true})); } catch(e){}
            }, 800);
            
            // Auto-clicker
            let attempts = 0;
            let clickTimer = setInterval(() => {
                let jwBtn = document.querySelector('.jw-display-icon-container, .vjs-big-play-button');
                if (jwBtn) jwBtn.click();
                
                if (window.jwplayer && typeof window.jwplayer === 'function') {
                    try { window.jwplayer().play(); } catch(e) {}
                }
                
                if (++attempts > 200) {
                    clearInterval(clickTimer);
                    reject("Timeout esperando el reproductor JWPlayer");
                }
            }, 100);
            
        } catch(e) {
            reject(e.message);
        }
    });
}
