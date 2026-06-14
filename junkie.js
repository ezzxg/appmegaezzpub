async function extract(url) {
    return new Promise((resolve, reject) => {
        try {
            nitro.log("Iniciando extraccion de JunkieEmbeds...");
            
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
            
            // 4. PRESERVAR QUERYSELECTOR NATIVO
            // blast.js hookea querySelector. Guardamos una copia pura antes de que cargue.
            html = html.replace(/<script[^>]*src="\/blast\.js[^>]*>/i, 
                "<script>window._nq = document.querySelector.bind(document); window._ng = document.getElementById.bind(document);</script>$&"
            );
            
            // 5. Escribir el DOM limpio en el motor Nitro
            document.open();
            document.write(html);
            document.close();
            
            // 6. Nuestro propio clicker blindado
            let attempts = 0;
            let clickTimer = setInterval(() => {
                // Usamos el querySelector nativo rescatado
                let qs = window._nq || document.querySelector.bind(document);
                
                // Buscar el botón de JWPlayer o cualquier botón
                let jwBtn = qs('.jw-display-icon-container') || qs('.vjs-big-play-button') || qs('button') || qs('.jw-icon-display');
                
                if (jwBtn) {
                    nitro.log("Junkie: Reproductor encontrado, forzando click...");
                    jwBtn.click();
                    
                    // También forzamos el API si está disponible
                    if (window.jwplayer && typeof window.jwplayer === 'function') {
                        try { window.jwplayer().play(); } catch(e) {}
                    }
                }
                
                if (++attempts > 150) { // 15 segundos
                    clearInterval(clickTimer);
                    reject("Timeout esperando el reproductor");
                }
            }, 100);
            
            // No resolvemos la promesa. Dejamos que el interceptor nativo atrape el .m3u8.
        } catch(e) {
            reject(e.message);
        }
    });
}
