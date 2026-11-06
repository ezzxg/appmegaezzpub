/**
 * Nitro Driver para dembed.st (daddy.php) - v77
 *
 * El manifiesto base esta en el HTML:  const SRC = "...index.m3u8"
 * pero el EDGE solo sirve la playlist si lleva la firma:
 *
 *   SRC + "?t=" + encodeURIComponent(token) + "&_=" + Date.now()
 *
 * El token NO esta en el HTML. El player de la pagina lo pide a:
 *   GET {EDGE}/api/playlist-token?slug={CHANNEL}
 * y el servidor solo responde 200 si el request lleva:
 *   Origin: {origen de la pagina embed}
 *
 * Este driver replica exactamente esa secuencia (verificada 200 +#EXTM3U).
 *
 * OJO: al pedir la pagina NO hay que mandar Sec-Fetch-* ni Referer.
 * Con esos headers el servidor devuelve 403 "This player only works when
 * embedded."; un request plano con User-Agent devuelve 200 (702 KB).
 *
 * Regla del motor: solo `function` en nivel superior (nada de const/let),
 * porque el script se inyecta DESPUES del IIFE que llama a extract().
 */

async function extract(url) {
    return await _dembed_extract(url);
}

async function _dembed_extract(url) {
    nitro.log("🔍 [dembed] Iniciando: " + url);

    var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    // Origen de la pagina (para el header Origin que exige el edge)
    var pageOrigin = "https://dembed.st";
    try {
        var hostMatch = url.match(/^(https?:\/\/[^\/]+)/i);
        if (hostMatch) pageOrigin = hostMatch[1];
    } catch (e) {}

    // ---------------------------------------------------------------
    // 1) HTML del embed. Sin Referer y sin Sec-Fetch-* (si no: 403).
    // ---------------------------------------------------------------
    var pageJson = nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
    }));

    var html = "";
    try {
        var pageRes = JSON.parse(pageJson || "{}");
        html = pageRes.body || "";
        nitro.log("📦 [dembed] HTML status=" + (pageRes.status || "?") + " len=" + html.length);
    } catch (e) {
        nitro.log("❌ [dembed] Error parseando HTML: " + e.message);
        html = "";
    }

    if (!html) {
        nitro.log("❌ [dembed] No se obtuvo el HTML del embed");
        return null;
    }

    // ---------------------------------------------------------------
    // 2) Extraer SRC (manifiesto), CHANNEL y EDGE del propio HTML.
    // ---------------------------------------------------------------
    var src = "";
    var channel = "";
    var edge = "";

    var mSrc = html.match(/const\s+SRC\s*=\s*["']([^"']+)["']/);
    if (mSrc) src = mSrc[1].replace(/\\\//g, "/");

    var mCh = html.match(/const\s+CHANNEL\s*=\s*["']([^"']+)["']/);
    if (mCh) channel = mCh[1];

    var mEdge = html.match(/const\s+EDGE\s*=\s*["']([^"']+)["']/);
    if (mEdge) edge = mEdge[1].replace(/\\\//g, "/");

    // Fallback: cualquier .m3u8 del HTML (comportamiento anterior)
    if (!src) {
        var mAny = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
        if (mAny) src = mAny[0].replace(/\\\//g, "/");
    }

    if (!src) {
        nitro.log("❌ [dembed] No se encontro SRC/m3u8 en el HTML");
        return null;
    }

    if (src.indexOf("//") === 0) src = "https:" + src;

    // EDGE: si no estaba, usar el origen del SRC
    if (!edge) {
        var mOrigin = src.match(/^(https?:\/\/[^\/]+)/i);
        edge = mOrigin ? mOrigin[1] : pageOrigin;
    }

    // CHANNEL: si no estaba, deducirlo del path del SRC (/premium537/index.m3u8)
    if (!channel) {
        var mSlug = src.match(/\/([^\/]+)\/[^\/]*\.m3u8/i);
        if (mSlug) channel = mSlug[1];
    }

    nitro.log("🎯 [dembed] SRC=" + src + " | CHANNEL=" + channel + " | EDGE=" + edge);

    // ---------------------------------------------------------------
    // 3) Token de playlist. Requiere header Origin (el Referer solo no basta).
    // ---------------------------------------------------------------
    var token = "";
    if (channel) {
        var tokenUrl = edge + "/api/playlist-token?slug=" + encodeURIComponent(channel);

        var tokenJson = nitro.fetchFull(tokenUrl, "GET", null, JSON.stringify({
            "User-Agent": UA,
            "Origin": pageOrigin,
            "Referer": pageOrigin + "/",
            "Accept": "application/json, text/plain, */*"
        }));

        try {
            var tokRes = JSON.parse(tokenJson || "{}");
            nitro.log("🎫 [dembed] token status=" + (tokRes.status || "?"));
            var tokBody = JSON.parse(tokRes.body || "{}");
            if (tokBody && tokBody.token) token = tokBody.token;
        } catch (e) {
            nitro.log("⚠️ [dembed] No se pudo parsear el token: " + e.message);
        }

        // Reintento sin Referer (por si el edge cambia la validacion)
        if (!token) {
            var tokenJson2 = nitro.fetchFull(tokenUrl, "GET", null, JSON.stringify({
                "User-Agent": UA,
                "Origin": pageOrigin,
                "Accept": "application/json, text/plain, */*"
            }));
            try {
                var tokRes2 = JSON.parse(tokenJson2 || "{}");
                var tokBody2 = JSON.parse(tokRes2.body || "{}");
                if (tokBody2 && tokBody2.token) token = tokBody2.token;
            } catch (e2) {}
        }
    }

    // ---------------------------------------------------------------
    // 4) Armar la URL firmada igual que cleanPlaylistUrl() del player:
    //    se quitan _ y t previos, y se agregan t=<token> y _=<ms>.
    // ---------------------------------------------------------------
    var base = src.split("?")[0];
    var finalUrl = base;
    if (token) {
        finalUrl = base + "?t=" + encodeURIComponent(token) + "&_=" + Date.now();
        nitro.log("✅ [dembed] URL firmada: " + finalUrl);
    } else {
        nitro.log("⚠️ [dembed] Sin token; se devuelve el SRC base (el edge dara 403)");
        finalUrl = src;
    }

    var result = {
        url: finalUrl,
        headers: {
            "User-Agent": UA,
            "Origin": pageOrigin,
            "Referer": pageOrigin + "/"
        }
    };

    nitro.onResult(JSON.stringify(result));
    return result;
}
