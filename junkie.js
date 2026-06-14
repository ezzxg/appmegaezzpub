async function extract(url) {
    return new Promise((resolve, reject) => {
        try {
            nitro.log("Iniciando extraccion de JunkieEmbeds...");
            
            let html = nitro.fetch(url);
            if (!html) return reject("Error obteniendo HTML");
            
            // Inyectar <base> y rescatar querySelector NATIVO al mismísimo principio del <head>
            // Esto vence al script inline de blast.js que hookea el DOM!
            let inyeccionSalvavidas = `
                <base href='https://junkieembeds.pages.dev/'>
                <script>
                    window._nq = document.querySelector.bind(document);
                </script>
            `;
            
            if (html.includes("<head>")) {
                html = html.replace("<head>", "<head>" + inyeccionSalvavidas);
            } else {
                html = inyeccionSalvavidas + html;
            }
            
            // ELIMINAR LA TRAMPA!
            html = html.replace(/<div id="embedBtn"[^>]*>[\s\S]*?<\/div>/g, "");
            html = html.replace(/<div id="embedModal"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g, "");
            
            // Escribir el DOM limpio
            document.open();
            document.write(html);
            document.close();
            
            let attempts = 0;
            let clickTimer = setInterval(() => {
                let qs = window._nq || document.querySelector.bind(document);
                
                let jwBtn = qs('.jw-display-icon-container') || qs('.vjs-big-play-button') || qs('button');
                
                if (jwBtn) {
                    nitro.log("Junkie: Reproductor encontrado, forzando click...");
                    jwBtn.click();
                    
                    if (window.jwplayer && typeof window.jwplayer === 'function') {
                        try { window.jwplayer().play(); } catch(e) {}
                    }
                }
                
                if (++attempts > 150) { // 15 segundos
                    clearInterval(clickTimer);
                    reject("Timeout esperando el reproductor");
                }
            }, 100);
            
        } catch(e) {
            reject(e.message);
        }
    });
}
