/**
 * Nitro Driver para dembed.st / daddy.php (v76)
 * CAPTURA OBLIGATORIA de parámetros t y _ en la URL m3u8
 * El servidor los exige firmes para playback
 */

async function extract(url) {
    return await _dembed_extract(url);
}

// Implementación real - Forzando captura completa de URL con params
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

    // 1. Buscar URL m3u8 - PATRÓN OBLIGATORIO que captura TODO incluyendo ?t= & _=
    // Este patrón captura: https://domain.com/file.m3u8?t=123&_=456 CUALQUIERA QUE VENGA DESPUÉS
    let m3u8Url = null;

    // PATRÓN PRINCIPAL: https://cualquier_cosa.m3u8?param1=valor1&param2=valor2
    // El [^\s"'<>]* captura TODOS los caracteres que no sean espacio, comilla o < >
    const mainPattern = /https?:\/\/[^\s"'<>]*\.m3u8[^\s"'<>]*/i;
    const mainMatch = html.match(mainPattern);

    if (mainMatch && mainMatch[0]) {
        m3u8Url = mainMatch[0].replace(/\\\//g, "/");
        // NO recortamos nada - preservamos TODOS los caracteres incluyendo ?t= & _=
        nitro.log("🎯 [DEMBED] URL m3u8 OBLIGATORIA capturada (COMPLETA): " + m3u8Url);
    } else {
        nitro.log("⚠️ [DEMBED] No coincidió patrón principal, intentando alternativos...");
        
        // PATRÓN SECUNDARIO: var playbackURL = "url"
        const playbackMatch = html.match(/var\s+playbackURL\s*=\s*["']([^"']+)["']/i);
        if (playbackMatch && playbackMatch[1]) {
            m3u8Url = playbackMatch[1].replace(/\\\//g, "/");
            nitro.log("🎯 [DEMBED] playbackURL var: " + m3u8Url);
        }
        
        // PATRÓN SECUNDARIO: playbackURL = (sin comillas)
        if (!m3u8Url) {
            const directMatch = html.match(/playbackURL\s*=\s*["']([^"']+)["']/i);
            if (directMatch && directMatch[1]) {
                m3u8Url = directMatch[1].replace(/\\\//g, "/");
                nitro.log("🎯 [DEMBED] playbackURL directo: " + m3u8Url);
            }
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
        nitro.log("✅ [DEMBEND] Extracción exitosa con URL completa: " + m3u8Url);
        nitro.onResult(JSON.stringify(result));
        return result;
    }

    nitro.log("❌ [DEMBED] No se encontrÍ URL de stream válida");
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