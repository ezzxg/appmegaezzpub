/**
 * Nitro Driver para dembed.st / daddy.php (v76)
 * CAPTURA OBLIGATORIA de parámetros t y _ en la URL m3u8 desde var playbackURL
 * El servidor los exige firmes para playback
 */

async function extract(url) {
    return await _dembed_extract(url);
}

// Implementación real - Prioridad 1: var playbackURL = "URL_COMPLETA"
async function _dembed_extract(url) {
    nitro.log("🔍 [DEMBED] Iniciando extracción para: " + url);

    // === FORZAR Referer/Origin fijos a dembed.st ===
    const FIXED_REFERER = "https://dembed.st/";
    const FIXED_ORIGIN = "https://dembed.st";

    nitro.log("🔒 [DEMBED] Usando Referer fijo: " + FIXED_REFERER);

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
    } catch(e) {
        nitro.log("🔴 [DEMBED] Error parseando respuesta: " + e.message);
        html = "";
    }

    if (!html) {
        nitro.log("🔴 [DEMBED] No se pudo obtener el HTML");
        nitro.onResult(JSON.stringify(null));
        return null;
    }

    // === PRIORIDAD 1: Buscar var playbackURL = "URL_COMPLETA con todos los params ===
    // Este es el patrón más común en dembed.st/ daddy.php
    // Captura TODO lo que esté dentro de las comillas después de playbackURL=
    let m3u8Url = null;

    // Patrón: var playbackURL = "https://... .m3u8?t=...&_=..."
    const playbackMatch = html.match(/var\s+playbackURL\s*=\s*["']([^"']+)["']/i);
    if (playbackMatch && playbackMatch[1]) {
        m3u8Url = playbackMatch[1].replace(/\\\//g, "/");
        // Este es el caso clave: la URL COMPLETA con params t y _ viene dentro de las comillas
        nitro.log("🎯 [DEMBED] playbackURL encontrado CON parámetros (t & _): " + m3u8Url);
        // No hacemos ningún replace que los quite - los conservamos tal cual
    } else {
        nitro.log("⚠️ [DEMBED] No encontró var playbackURL, intentando patrón alternativo...");
        
        // PRIORIDAD 2: Buscar cualquier .m3u8 URL en el HTML preservando parámetros
        // Patrón que captura desde https hasta el siguiente " o espacio, incluyendo ?t= & _=
        const altPattern = /https?:\/\/[^\s"',]+\.m3u8[^\s"',]*/i;
        const altMatch = html.match(altPattern);
        
        if (altMatch && altMatch[0]) {
            m3u8Url = altMatch[0].replace(/\\\//g, "/");
            nitro.log("🎯 [DEMBED] URL m3u8 capturada (patrón alt): " + m3u8Url);
        } else {
            nitro.log("⚠️ [DEMBED] No se encontró URL m3u8 con patrones alternativos");
        }
    }

    // Si encontramos URL, devolverla PRESERVIENDO TODOS los parámetros t, _
    if (m3u8Url && m3u8Url.startsWith("http")) {
        const result = {
            url: m3u8Url,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Referer": FIXED_REFERER,
                "Origin": FIXED_ORIGIN
            }
        };
        nitro.log("✅ [DEMBEND] Extracción exitosa CON URL completa y parámetros: " + m3u8Url);
        nitro.onResult(JSON.stringify(result));
        return result;
    }

    nitro.log("❌ [DEMBED] No se encontrÍ URL de stream válida con parámetros");
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