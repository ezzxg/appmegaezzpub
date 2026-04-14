/**
 * Nitro Driver para Apl401.me (v55.72)
 * Resolución de streaming en vivo con bypass de seguridad.
 */
async function extract(url) {
    // 1. Obtener HTML mediante el puente Nitro
    const html = await nitro.fetch(url);
    if (!html) return null;
    
    // 2. Localizar la inicialización del reproductor pl.init('...')
    // El stream suele estar en el primer argumento de la función init.
    const match = html.match(/pl\.init\(['"]([^'"]+)['"]\)/);
    
    if (match && match[1]) {
        let streamUrl = match[1];
        
        // Normalización de protocolos
        if (streamUrl.startsWith('//')) {
            streamUrl = 'https:' + streamUrl;
        }
        
        // 3. Retornar el MediaSource con cabeceras de identidad forzadas (Firma Brave v55.73)
        return {
            url: streamUrl,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "none",
                "Sec-GPC": "1",
                "sec-ch-ua": "\"Chromium\";v=\"146\", \"Not-A.Brand\";v=\"24\", \"Brave\";v=\"146\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"Windows\""
            }
        };
    }
    
    // Fallback: Si no está en pl.init, buscar m3u8 directo en el HTML
    const directMatch = html.match(/['"](https?:[^'"]+\.m3u8[^'"]*)['"]/);
    if (directMatch) {
        return {
            url: directMatch[1].replace(/\\/g, ''),
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
                "Sec-Fetch-Site": "none"
            }
        };
    }

    return null;
}
