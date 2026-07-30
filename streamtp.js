/**
 * Nitro Driver para StreamTP / Global1 (v55.130)
 * Soporta la extracción directa de playbackURL e index.m3u8 para dominios streamtp99a.sbs, global1.php, etc.
 */
async function extract(url) {
    nitro.log("🔍 Iniciando Extracción Nitro para StreamTP/Global1: " + url);
    
    // Extraer el host para construir Referer y Origin
    let host = "streamtp99a.sbs";
    try {
        const hostMatch = url.match(/https?:\/\/([^\/]+)/);
        if (hostMatch) host = hostMatch[1];
    } catch(e) {}
    
    const referer = "https://" + host + "/";
    const origin = "https://" + host;
    
    // Obtener HTML con cabeceras de navegación
    const responseJson = nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": referer,
        "Origin": origin
    }));
    
    const response = JSON.parse(responseJson || "{}");
    const html = response.body || "";
    
    if (!html) {
        nitro.log("❌ No se pudo obtener el HTML de StreamTP");
        return null;
    }
    
    // 1. Buscar asignación directa de playbackURL (Nuevo formato streamtp99a)
    const playbackMatch = html.match(/playbackURL\s*=\s*["']([^"']+)["']/i);
    let m3u8Url = null;
    
    if (playbackMatch && playbackMatch[1]) {
        m3u8Url = playbackMatch[1].replace(/\\\//g, "/");
        nitro.log("🎯 playbackURL encontrado: " + m3u8Url);
    } else {
        // Fallback: Buscar cualquier URL .m3u8 directa o escapada
        const rawMatch = html.match(/https?:\\?\/\\?\/[^"'\s]+\.m3u8[^"'\s]*/i);
        if (rawMatch) {
            m3u8Url = rawMatch[0].replace(/\\\//g, "/");
            nitro.log("🎯 m3u8 directo encontrado en HTML: " + m3u8Url);
        }
    }
    
    if (m3u8Url && m3u8Url.startsWith("http")) {
        return {
            url: m3u8Url,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Referer": referer,
                "Origin": origin
            }
        };
    }
    
    nitro.log("⚠️ No se encontró la URL del stream en StreamTP");
    return null;
}
