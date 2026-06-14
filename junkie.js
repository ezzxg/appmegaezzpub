async function extract(url) {
    return new Promise((resolve, reject) => {
        try {
            // 1. Descargamos el HTML original de JunkieEmbeds
            let html = nitro.fetch(url);
            if (!html) return reject("Error obteniendo HTML");
            
            // 2. Inyectar <base> para que todos los scripts relativos funcionen bien
            let baseTag = "<base href='https://junkieembeds.pages.dev/'>";
            if (html.includes("<head>")) {
                html = html.replace("<head>", "<head>" + baseTag);
            } else {
                html = baseTag + html;
            }
            
            // 3. ¡ELIMINAR LA TRAMPA!
            // JunkieEmbeds tiene un div role="button" que engaña al auto-clicker de la app. Lo borramos.
            html = html.replace(/<div id="embedBtn"[^>]*>[\s\S]*?<\/div>/g, "");
            html = html.replace(/<div id="embedModal"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g, "");
            
            // 4. Escribir el DOM limpio
            document.open();
            document.write(html);
            document.close();
            
            // 5. Nuestro propio clicker de precisión para JWPlayer
            let attempts = 0;
            let clickTimer = setInterval(() => {
                let jwBtn = document.querySelector('.jw-display-icon-container, .vjs-big-play-button');
                if (jwBtn) {
                    jwBtn.click();
                }
                
                if (window.jwplayer && typeof window.jwplayer === 'function') {
                    try { window.jwplayer().play(); } catch(e) {}
                }
                
                if (++attempts > 150) {
                    clearInterval(clickTimer);
                    reject("Timeout esperando el reproductor");
                }
            }, 100);
            
            // No resolvemos la promesa. Dejamos que el interceptor nativo del WebView atrape el .m3u8 por red.
        } catch(e) {
            reject(e.message);
        }
    });
}
