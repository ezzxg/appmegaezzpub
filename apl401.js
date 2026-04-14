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
        
        // 3. Retornar el MediaSource con cabeceras de identidad forzadas
        return {
            url: streamUrl,
            headers: {
                "Referer": "https://emb.apl401.me/",
                "Origin": "https://emb.apl401.me",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Sec-Fetch-Dest": "video",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site"
            }
        };
    }
    
    // Fallback: Si no está en pl.init, buscar m3u8 directo en el HTML
    const directMatch = html.match(/['"](https?:[^'"]+\.m3u8[^'"]*)['"]/);
    if (directMatch) {
        return {
            url: directMatch[1].replace(/\\/g, ''),
            headers: {
                "Referer": "https://emb.apl401.me/",
                "Origin": "https://emb.apl401.me"
            }
        };
    }

    return null;
}
