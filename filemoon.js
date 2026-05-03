/**
 * [v55.120] Driver Nitro Cloud: FILEMOON.SX
 * Soporta rastreo de iframes dinámicos y desempaquetado de Packer.
 */
async function extract(url) {
    nitro.log("🔍 Nitro Driver Cloud: Filemoon.sx activado");
    
    // 1. Obtener HTML de la página de entrada
    const html = nitro.fetch(url, JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    }));

    if (!html) {
        nitro.log("❌ No se pudo cargar la página de Filemoon");
        return null;
    }

    // 2. Buscar el iframe del reproductor (a veces el link directo está en un iframe)
    const iframeMatch = html.match(/<iframe\s+[^>]*src=["']([^"']+)["']/i);
    let targetHtml = html;
    let currentUrl = url;

    if (iframeMatch) {
        let iframeUrl = iframeMatch[1];
        if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
        
        nitro.log("🌐 Saltando al iframe: " + iframeUrl);
        const iframeHtml = nitro.fetch(iframeUrl, JSON.stringify({
            "Referer": url,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        }));
        
        if (iframeHtml) {
            targetHtml = iframeHtml;
            currentUrl = iframeUrl;
        }
    }

    // 3. Buscar el bloque Packer en el HTML (estándar de Filemoon)
    const packerRegex = /eval\s*\(\s*function\s*\(p\s*,\s*a\s*,\s*c\s*,\s*k\s*[,e\s*|,\s*d\s*]*\).*?\}\s*\(\s*['"](.*?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"](.*?)['"]\.split\(['"]\|['"]\)/;
    const pMatch = targetHtml.match(packerRegex);
    
    if (pMatch) {
        try {
            nitro.log("📦 Detectado bloque Packer, desempaquetando...");
            const unpacked = nitro.unpack(pMatch[1], parseInt(pMatch[2]), JSON.stringify(pMatch[4].split('|')));
            
            // Buscar m3u8 en el código desempaquetado
            const m3u8Match = unpacked.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) || 
                              unpacked.match(/sources\s*:\s*\[\s*{\s*file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) ||
                              unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
            
            if (m3u8Match) {
                const streamUrl = m3u8Match[1].replace(/\\\//g, "/");
                nitro.log("🎯 Stream capturado: " + streamUrl);
                
                return {
                    url: streamUrl,
                    headers: {
                        "Referer": currentUrl,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                        "Origin": new URL(currentUrl).origin
                    }
                };
            }
        } catch (e) {
            nitro.log("⚠️ Error desempaquetando Packer: " + e.message);
        }
    }

    // 4. Intento de búsqueda directa si Packer falla
    const directMatch = targetHtml.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
    if (directMatch) {
        return {
            url: directMatch[1].replace(/\\\//g, "/"),
            headers: {
                "Referer": currentUrl,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            }
        };
    }

    nitro.log("❌ No se encontró señal de video en Filemoon");
    return null;
}
