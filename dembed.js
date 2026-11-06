/**
 * Nitro Driver para dembed.st / daddy.php (v76)
 * Captura URL completa con parámetros firma (t, _) para evitar 403
 * El servidor requiere los parámetros exactos del HTML original
 */

async function extract(url) {
    return await _dembed_extract(url);
}

// Implementación real - CAPTURA COMPLETA DE URL CON PARAMETROS
async function _dembed_extract(url) {
    nitro.log("🔍 [DEMBED] Iniciando extracción para: " + url);

    // === FORZAR Referer/Origin fijos a dembed.st ===
    // El servidor dembed.st requiere que el Referer sea siempre dembed.st
    const FIXED_REFERER = "https://dembed.st/";
    const FIXED_ORIGIN = "https://dembed.st";

    nitro.log("🔒 [DEMBED] Usando Referer fijo: " + FIXED_REFERER);

    // PeticiÓn HTTP directa con OkHeaders fijos
    const responseJson = nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": FIXED_REFERER,
        "Origin": FIXED_ORIGIN,
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
        nitro.log("📦 [DEMBEND] HTTP Status: " + (response.status || "?") + " - Body length: " + html.length);
        if (html.contains("This player only works when embedded")) {
            nitro.log("🚫 [DEMBED] Bloqueo iframe detectado - usando Referer fijo");
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

    // 1. Buscar URL m3u8 completa preservando todos los parámetros (t, _, firma, etc.)
    let m3u8Url = null;

    // Patrón 1: Buscar var playbackURL = "url completa con parámetros"
    const playbackMatch = html.match(/var\s+playbackURL\s*=\s*["']([^"']+)["']/i);
    if (playbackMatch && playbackMatch[1]) {
        m3u8Url = playbackMatch[1].replace(/\\\//g, "/");
        nitro.log("🎯 [DEMBED] playbackURL encontrado (var): " + m3u8Url);
    }

    // Patrón 2: Buscar playbackURL sin comillas
    if (!m3u8Url) {
        const directMatch = html.match(/playbackURL\s*=\s*["']([^"']+)["']/i);
        if (directMatch && directMatch[1]) {
            m3u8Url = directMatch[1].replace(/\\\//g, "/");
            nitro.log("🎯 [DEMBED] playbackURL encontrado (directo): " + m3u8Url);
        }
    }

    // Patrón 3: Buscar URL .m3u8 completa preservando todo lo que venga después (incluyendo ?t= & _=)
    // Esto es lo más importante - capturar la URL completa tal como está en el HTML
    if (!m3u8Url) {
        // Este patrón captura https://.../index.m3u8?t=...&_=... o cualquier parámetro posterior
        const directM3u8 = html.match(/https?:\/\/[^\s"'<>]*\.m3u8[^\s"'<>]*/i);
        if (directM3u8) {
            m3u8Url = directM3u8[0].replace(/\\\//g, "/");
            // NO recortamos nada - preservamos TODOS los parámetros t, _, etc.
            nitro.log("🎯 [DEMBED] m3u8 encontrado por búsq (COMPLETO): " + m3u8Url);
        }
    }

    // Patrón 4: Buscar en iframes src
    if (!m3u8Url) {
        const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (iframeMatch) {
            nitro.log("🔄 [DEMBED] Encontrado iframe src...");
        }
    }

    // Patrón 5: Buscar source tags
    if (!m3u8Url) {
        const sourceMatch = html.match(/<source[^>]+src=["']([^"']+)["']/i);
        if (sourceMatch) {
            nitro.log("🔄 [DEMBED] Encontrado source src...");
        }
    }

    // Si encontramos URL, devolverla preservando TODOS los parámetros
    if (m3u8Url && m3u8Url.startsWith("http")) {
        const result = {
            url: m3u8Url,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Referer": FIXED_REFERER,
                "Origin": FIXED_ORIGIN
            }
        };
        nitro.log("✅ [DEMBEND] Extracción exitosa: " + m3u8Url);
        nitro.onResult(JSON.stringify(result));
        return result;
    }

    nitro.log("❌ [DEMBED] No se encontrÍ URL de stream en la respuesta");
    nitro.onResult(JSON.stringify(null));
    return null;
}

// AUTO-EJECUCIÓN
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