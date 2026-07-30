/**
 * Nitro Driver para StreamTP / Global1 (v55.140)
 * Auto-ejecutable: no depende del IIFE externo del motor Nitro.
 * Funciona con el orden de inyección de NitroScriptEngine donde el script
 * llega DESPUÉS de la llamada a extract().
 */

// Definir extract() para compatibilidad con motores que lo llaman correctamente
async function extract(url) {
    return await _streamtp_extract(url);
}

// Implementación real
async function _streamtp_extract(url) {
    nitro.log("🔍 [StreamTP v55.140] Iniciando extracción para: " + url);

    // Extraer el host para construir Referer y Origin
    let host = "streamtp99a.sbs";
    try {
        const hostMatch = url.match(/https?:\/\/([^\/]+)/);
        if (hostMatch) host = hostMatch[1];
    } catch(e) {}

    const referer = "https://" + host + "/";
    const origin = "https://" + host;

    // Petición HTTP directa con OkHttp (no WebView, sin anti-embedding)
    const responseJson = nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": referer,
        "Origin": origin,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
    }));

    let html = "";
    try {
        const response = JSON.parse(responseJson || "{}");
        html = response.body || "";
        nitro.log("📡 [StreamTP] HTTP Status: " + (response.status || "?") + " - Body length: " + html.length);
    } catch(e) {
        nitro.log("❌ [StreamTP] Error parseando respuesta: " + e.message);
    }

    if (!html) {
        nitro.log("❌ [StreamTP] No se pudo obtener el HTML");
        nitro.onResult(JSON.stringify(null));
        return null;
    }

    // 1. Buscar formato nuevo: var playbackURL = "https://..."
    let m3u8Url = null;
    const playbackMatch = html.match(/var\s+playbackURL\s*=\s*["']([^"']+)["']/i);
    if (playbackMatch && playbackMatch[1]) {
        m3u8Url = playbackMatch[1].replace(/\\\//g, "/");
        nitro.log("🎯 [StreamTP] playbackURL encontrado (formato var): " + m3u8Url);
    }

    // 2. Fallback: asignación directa sin "var"
    if (!m3u8Url) {
        const directMatch = html.match(/playbackURL\s*=\s*["']([^"']+)["']/i);
        if (directMatch && directMatch[1]) {
            m3u8Url = directMatch[1].replace(/\\\//g, "/");
            nitro.log("🎯 [StreamTP] playbackURL encontrado (asignación directa): " + m3u8Url);
        }
    }

    // 3. Fallback: buscar cualquier URL .m3u8 en el HTML
    if (!m3u8Url) {
        const rawMatch = html.match(/https?:[\\\/]+[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
        if (rawMatch) {
            m3u8Url = rawMatch[0].replace(/\\\//g, "/").replace(/\\/g, "/");
            nitro.log("🎯 [StreamTP] m3u8 encontrado por búsqueda directa: " + m3u8Url);
        }
    }

    if (m3u8Url && m3u8Url.startsWith("http")) {
        const result = {
            url: m3u8Url,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Referer": referer,
                "Origin": origin
            }
        };
        nitro.log("✅ [StreamTP] Extracción exitosa: " + m3u8Url);
        nitro.onResult(JSON.stringify(result));
        return result;
    }

    nitro.log("⚠️ [StreamTP] No se encontró URL de stream en la respuesta");
    nitro.onResult(JSON.stringify(null));
    return null;
}

// AUTO-EJECUCIÓN: el motor Nitro inyecta este script DESPUÉS de llamar extract(),
// así que lo ejecutamos manualmente al final para que también funcione en ese caso.
(function() {
    try {
        // Obtener la URL del targetUrl que el motor setea como variable global o desde el contexto
        // El motor llama extract(targetUrl) antes de inyectar el script.
        // Si extract ya fue llamado, ya retornó undefined y el motor espera onResult.
        // Lo llamamos nosotros desde aquí con la URL correcta.
        const scriptSrc = document.currentScript ? document.currentScript.src : "";
        // Intentar obtener la URL desde el contexto del motor
        if (typeof __nitro_target_url !== 'undefined' && __nitro_target_url) {
            _streamtp_extract(__nitro_target_url).catch(function(e) {
                nitro.log("❌ [StreamTP Auto] Error: " + e.message);
                nitro.onResult(JSON.stringify(null));
            });
        }
    } catch(e) {
        // Silenciar errores del auto-execute
    }
})();
