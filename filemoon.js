/**
 * [v55.121] Driver Nitro Cloud: FILEMOON.SX (Direct Mode)
 * Extracción directa desde el embed principal sin saltos.
 */
async function extract(url) {
    nitro.log("🔍 Nitro Driver Cloud: Filemoon.sx (Direct) activado");
    
    // 1. Cargar el embed directamente
    const html = nitro.fetch(url, JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://filemoon.sx/"
    }));

    if (!html) {
        nitro.log("❌ Error cargando el embed");
        return null;
    }

    // 2. Buscar Packer directamente en la página principal
    const packerRegex = /eval\s*\(\s*function\s*\(p\s*,\s*a\s*,\s*c\s*,\s*k\s*[,e\s*|,\s*d\s*]*\).*?\}\s*\(\s*['"](.*?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"](.*?)['"]\.split\(['"]\|['"]\)/;
    const pMatch = html.match(packerRegex);
    
    if (pMatch) {
        try {
            nitro.log("📦 Packer detectado en el embed principal, procesando...");
            const unpacked = nitro.unpack(pMatch[1], parseInt(pMatch[2]), JSON.stringify(pMatch[4].split('|')));
            
            // Buscar m3u8 en el código desempaquetado
            const m3u8Match = unpacked.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) || 
                              unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
            
            if (m3u8Match) {
                const streamUrl = m3u8Match[1].replace(/\\\//g, "/");
                nitro.log("🎯 Stream capturado: " + streamUrl);
                
                return {
                    url: streamUrl,
                    headers: {
                        "Referer": url,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                        "Origin": "https://filemoon.sx"
                    }
                };
            }
        } catch (e) {
            nitro.log("⚠️ Error en desempaquetado: " + e.message);
        }
    }

    // 3. Búsqueda HEURÍSTICA directa (si no está empaquetado)
    const directMatch = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) ||
                        html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
    
    if (directMatch) {
        const streamUrl = directMatch[1].replace(/\\\//g, "/");
        nitro.log("🎯 Stream directo capturado: " + streamUrl);
        return {
            url: streamUrl,
            headers: {
                "Referer": url,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            }
        };
    }

    nitro.log("❌ No se encontró señal m3u8 en el embed principal");
    return null;
}
