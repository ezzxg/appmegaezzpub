/**
 * Nitro Driver para tvf90.com (v72.0)
 * Extracción directa de m3u8 desde variable const playbackURL.
 * Formato: 1.php?stream={canal} → iframe → 5.php?stream={canal}
 * El token del m3u8 viene incluido en la URL (atiende a IP).
 * Anti-embedding (block.html) NO afecta: nitro.fetchFull usa OkHttp, no WebView.
 */
async function extract(url) {
    nitro.log("🔍 [tvf90] Iniciando extracción para: " + url);

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    // Si la URL es 1.php (wrapper), pasar directo a 5.php (reproductor real)
    let playerUrl = url;
    if (url.includes("/1.php")) {
        playerUrl = url.replace("/1.php", "/5.php");
        nitro.log("🔗 [tvf90] Wrapper detectado, redirigiendo a: " + playerUrl);
    }

    // Fetch del HTML del reproductor
    const pageJson = nitro.fetchFull(playerUrl, "GET", null, JSON.stringify({
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }));

    let html = "";
    try { html = JSON.parse(pageJson || "{}").body || ""; } catch(e) {}
    if (!html) {
        nitro.log("❌ [tvf90] No se obtuvo el HTML");
        nitro.onResult(JSON.stringify(null));
        return null;
    }

    // Buscar const playbackURL = "https://..."
    const match = html.match(/const playbackURL\s*=\s*["']([^"']+)["']/);
    if (!match || !match[1]) {
        nitro.log("⚠️ [tvf90] No se encontró playbackURL en el HTML");
        nitro.onResult(JSON.stringify(null));
        return null;
    }

    let m3u8Url = match[1].replace(/\\\//g, "/");
    if (!m3u8Url.startsWith("http")) {
        nitro.log("⚠️ [tvf90] URL inválida: " + m3u8Url);
        nitro.onResult(JSON.stringify(null));
        return null;
    }

    // Extraer host del dominio para Referer/Origin
    let siteHost = "tvf90.com";
    try {
        const h = url.match(/https?:\/\/([^\/]+)/);
        if (h) siteHost = h[1];
    } catch(e) {}

    const result = {
        url: m3u8Url,
        headers: {
            "User-Agent": UA,
            "Referer": "https://" + siteHost + "/",
            "Origin": "https://" + siteHost
        }
    };

    nitro.log("✅ [tvf90] Extracción exitosa: " + m3u8Url);
    nitro.onResult(JSON.stringify(result));
    return result;
}
