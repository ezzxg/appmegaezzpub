/**
 * Nitro Driver para wideiptv.top - v2
 *
 * Entradas soportadas:
 *   - https://wideiptv.top/daddy.php?stream=DAZNF1ES
 *   - https://wideiptv.top/player/DAZNF1ES
 *
 * La pagina /player/{slug} trae la config del reproductor:
 *   const config = {
 *       streamUrl: "https://cdn.wideiptv.top/{slug}/index.m3u8?token=...",
 *       channelSlug: "...",
 *       tokenExpiresIn: 300,
 *       currentToken: "..."
 *   }
 *
 * El token es base64(payload).firma y CADUCA (~300 s). Por eso, ademas de
 * leer el de la pagina, se pide uno fresco a:
 *   POST https://wideiptv.top/api/refresh_token.php
 *   body: {"channel":"<slug>","current_token":"<token>"}
 *   -> {"success":true,"token":"...","expires_in":300}
 *
 * El CDN no exige Referer; solo el parametro token. Verificado:
 * master 200 -> variante 200 -> segmento 206 (0x47 MPEG-TS).
 *
 * Regla del motor: solo `function` en nivel superior (nada de const/let),
 * porque el script se inyecta DESPUES del IIFE que llama a extract().
 * El puente expone nitro.log / nitro.fetchFull / nitro.onResult (NO nitro.error).
 */

async function extract(url) {
    return await _wideiptv_extract(url);
}

async function _wideiptv_extract(url) {
    nitro.log("🔍 [wideiptv] Iniciando: " + url);

    var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    // ---------------------------------------------------------------
    // 1) Slug: ?stream=SLUG  o  /player/SLUG
    // ---------------------------------------------------------------
    var slug = "";
    var mStream = url.match(/[?&]stream=([^&#]+)/i);
    if (mStream) {
        try { slug = decodeURIComponent(mStream[1]); } catch (e) { slug = mStream[1]; }
    }
    if (!slug) {
        var mPlayer = url.match(/\/player\/([^\/?#]+)/i);
        if (mPlayer) {
            try { slug = decodeURIComponent(mPlayer[1]); } catch (e) { slug = mPlayer[1]; }
        }
    }
    if (!slug) {
        nitro.log("❌ [wideiptv] No se pudo obtener el slug de: " + url);
        return null;
    }
    nitro.log("🎯 [wideiptv] slug=" + slug);

    // ---------------------------------------------------------------
    // 2) Host
    // ---------------------------------------------------------------
    var host = "wideiptv.top";
    var mHost = url.match(/^https?:\/\/([^\/]+)/i);
    if (mHost) host = mHost[1];

    var playerUrl = "https://" + host + "/player/" + encodeURIComponent(slug);
    var daddyRef = "https://" + host + "/daddy.php?stream=" + encodeURIComponent(slug);

    // ---------------------------------------------------------------
    // 3) Pagina del player (Referer = daddy.php?stream=SLUG)
    // ---------------------------------------------------------------
    var pageJson = nitro.fetchFull(playerUrl, "GET", null, JSON.stringify({
        "User-Agent": UA,
        "Referer": daddyRef,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
    }));

    var html = "";
    try {
        var pageRes = JSON.parse(pageJson || "{}");
        html = pageRes.body || "";
        nitro.log("📦 [wideiptv] player status=" + (pageRes.status || "?") + " len=" + html.length);
    } catch (e) {
        nitro.log("❌ [wideiptv] Error parseando player: " + e.message);
        return null;
    }

    if (!html) {
        nitro.log("❌ [wideiptv] player devolvio vacio");
        return null;
    }

    var streamUrl = "";
    var currentToken = "";

    var mUrl = html.match(/streamUrl\s*:\s*["']([^"']+)["']/i);
    if (mUrl) streamUrl = mUrl[1].replace(/\\\//g, "/").replace(/\\/g, "");

    var mTok = html.match(/currentToken\s*:\s*["']([^"']+)["']/i);
    if (mTok) currentToken = mTok[1];

    if (!streamUrl) {
        var mAny = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
        if (mAny) streamUrl = mAny[0].replace(/\\\//g, "/").replace(/\\/g, "");
    }

    if (!streamUrl) {
        nitro.log("❌ [wideiptv] No se encontro streamUrl en el player");
        return null;
    }
    nitro.log("🎬 [wideiptv] streamUrl=" + streamUrl);

    // ---------------------------------------------------------------
    // 4) Token fresco (la pagina puede venir cacheada con uno viejo)
    // ---------------------------------------------------------------
    if (currentToken) {
        var body = JSON.stringify({ channel: slug, current_token: currentToken });
        var rfJson = nitro.fetchFull("https://" + host + "/api/refresh_token.php", "POST", body, JSON.stringify({
            "User-Agent": UA,
            "Content-Type": "application/json",
            "Origin": "https://" + host,
            "Referer": playerUrl
        }));

        try {
            var rfRes = JSON.parse(rfJson || "{}");
            var rfBody = JSON.parse(rfRes.body || "{}");
            if (rfBody && rfBody.success && rfBody.token) {
                streamUrl = streamUrl.replace(/token=[^&]+/, "token=" + rfBody.token);
                nitro.log("🔄 [wideiptv] token refrescado (expires_in=" + (rfBody.expires_in || "?") + ")");
            } else {
                nitro.log("⚠️ [wideiptv] refresh sin exito; se usa el token de la pagina");
            }
        } catch (e) {
            nitro.log("⚠️ [wideiptv] Error en refresh: " + e.message);
        }
    }

    // ---------------------------------------------------------------
    // 5) Resultado
    // ---------------------------------------------------------------
    var result = {
        url: streamUrl,
        headers: {
            "User-Agent": UA,
            "Referer": "https://" + host + "/",
            "Origin": "https://" + host
        }
    };

    nitro.log("✅ [wideiptv] URL: " + streamUrl);
    nitro.onResult(JSON.stringify(result));
    return result;
}
