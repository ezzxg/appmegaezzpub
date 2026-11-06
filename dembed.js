/**
 * Nitro Driver para dembed.st / daddy.php (v76)
 * Manejo de player embebido - requiere Referer/Origin correctos
 * Mensaje: "This player only works when embedded." si no viene del iframe correcto
 */

async function extract(url) {
    return await _dembed_extract(url);
}

// Implementación real
async function _dembed_extract(url) {
    nitro.log("🔍 [DEMBED] Iniciando extracción para: " + url);

    // Extraer el host para construir Referer y Origin
    let host = "dembed.st";
    try {
        const hostMatch = url.match(/https?:\/\/([^\/]+)/);
        if (hostMatch) host = hostMatch[1];
    } catch(e) {}

    const referer = "https://" + host + "/";
    const origin = "https://" + host;

    // PeticiÓn HTTP directa con OkHttp (no WebView, sin anti-embedding)
    // Incluimos headers que simulan venir de un iframe embed
    const responseJson = nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": referer,
        "Origin": origin,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-site",
        "Cache-Control": "no-cache"
    }));

    let html = "";
    try {
        const response = JSON.parse(responseJson || "{}");
        html = response.body || "";
        nitro.log("📦 [DEMBED] HTTP Status: " + (response.status || "?") + " - Body length: " + html.length);
        if (html.contains("This player only works when embedded")) {
            nitro.log("🚫 [DEMBED] Mensaje de bloqueo de iframe detectado - intentando workaround...");
        }
    } catch(e) {
        nitro.log("🔴 [DEMBED] Error parseando respuesta: " + e.message);
        html = "";
    }

    if (!html) {
        nitro.log("🔴 [DEMBED] No se pudo obtener el HTML");
        nitro.onResult(JSON.stringify(null));
        return null;
    }

    // 1. Buscar URL m3u8 en el HTML - patrones comunes
    let m3u8Url = null;

    // Patrón 1: var playbackURL = "url"
    const playbackMatch = html.match(/var\s+playbackURL\s*=\s*["']([^"']+)["']/i);
    if (playbackMatch && playbackMatch[1]) {
        m3u8Url = playbackMatch[1].replace(/\\\//g, "/");
        nitro.log("🎯 [DEMBED] playbackURL encontrado (var): " + m3u8Url);
    }

    // Patrón 2: playbackURL = "url" (sin var)
    if (!m3u8Url) {
        const directMatch = html.match(/playbackURL\s*=\s*["']([^"']+)["']/i);
        if (directMatch && directMatch[1]) {
            m3u8Url = directMatch[1].replace(/\\\//g, "/");
            nitro.log("🎯 [DEMBED] playbackURL encontrado (directo): " + m3u8Url);
        }
    }

    // Patrón 3: URL .m3u8 directa en el HTML
    if (!m3u8Url) {
        const directM3u8 = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
        if (directM3u8) {
            m3u8Url = directM3u8[0].replace(/\\\//g, "/");
            nitro.log("🎯 [DEMBEND] m3u8 encontrado por búsq: " + m3u8Url);
        }
    }

    // Patrón 4: Buscar en iframes o sources dentro del HTML
    if (!m3u8Url) {
        const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (iframeMatch) {
            nitro.log("🔄 [DEMBED] Encontrado iframe src, continuando búsqueda...");
        }
    }

    // Patrón 5: Buscar en source tags o video tags
    if (!m3u8Url) {
        const sourceMatch = html.match(/<source[^>]+src=["']([^"']+)["']/i);
        if (sourceMatch) {
            nitro.log("🔄 [DEMBED] Encontrado source src: " + sourceMatch[1]);
        }
    }

    // Si encontramos URL, devolverla con headers
    if (m3u8Url && m3u8Url.startsWith("http")) {
        const result = {
            url: m3u8Url,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Referer": referer,
                "Origin": origin
            }
        };
        nitro.log("✅ [DEMBED] Extracción exitosa: " + m3u8Url);
        nitro.onResult(JSON.stringify(result));
        return result;
    }

    nitro.log("❌ [DEMBED] No se encontrÍ URL de stream en la respuesta");
    nitro.onResult(JSON.stringify(null));
    return null;
}

// AUTO-EJECUCIÓN: el motor Nitro inyecta este script DESPUÉS de llamar extract()
// El motor establece __nitro_target_url antes de inyectar, así que lo capturamos aquí
(function() {
    try {
        if (typeof __nitro_target_url !== 'undefined' && __nitro_target_url) {
            _dembed_extract(__nitro_target_url).catch(function(e) {
                nitro.log("🔴 [DEMBED Auto] Error: " + e.message);
                nitro.onResult(JSON.stringify(null));
            });
        }
    } catch(e) {
        // Silenciar errores del auto-execute
    }
})();