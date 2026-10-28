async function extract(url) {
    nitro.log("[wideiptv] Starting extraction for: " + url);

    // Extraer el slug del stream de la URL (daddy.php?stream=SkySportsF1)
    let slug = "";
    try {
        let parsed = new URL(url);
        slug = parsed.searchParams.get("stream") || "";
        if (!slug) {
            // Fallback: buscar en el path
            let m = url.match(/stream=([^&]+)/i);
            if (m) slug = decodeURIComponent(m[1]);
        }
    } catch(e) {}
    if (!slug) {
        nitro.error("[wideiptv] Could not extract stream slug from URL");
        return null;
    }
    nitro.log("[wideiptv] Stream slug: " + slug);

    let domain = "wideiptv.top";
    try {
        let parsed = new URL(url);
        domain = parsed.hostname;
    } catch(e) {}

    // La pagina player/ contiene el config con streamUrl (m3u8 + token)
    let playerUrl = "https://" + domain + "/player/" + slug;

    let headers = JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": "https://" + domain + "/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
    });

    let respJson = nitro.fetchFull(playerUrl, "GET", null, headers);
    if (!respJson) {
        nitro.error("[wideiptv] Empty response from fetchFull");
        return null;
    }

    let resp;
    try {
        resp = JSON.parse(respJson);
    } catch(e) {
        nitro.error("[wideiptv] Failed to parse response JSON");
        return null;
    }

    if (!resp.body) {
        nitro.error("[wideiptv] Response body is empty");
        return null;
    }

    let html = resp.body;
    nitro.log("[wideiptv] HTML length: " + html.length);

    // Extraer streamUrl del config: streamUrl: "https:\/\/host\/path\/index.m3u8?token=..."
    let m3u8Match = html.match(/streamUrl\s*:\s*"([^"]+)"/i);
    if (m3u8Match && m3u8Match[1]) {
        let streamUrl = m3u8Match[1].replace(/\\\//g, "/").replace(/\\/g, "");
        nitro.log("[wideiptv] Found streamUrl: " + streamUrl);
        return {
            url: streamUrl,
            headers: {
                "Referer": "https://" + domain + "/",
                "Origin": "https://" + domain,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
        };
    }

    // Fallback: regex generico para m3u8
    let fallbackMatch = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
    if (fallbackMatch && fallbackMatch[1]) {
        let streamUrl = fallbackMatch[1].replace(/\\\//g, "/").replace(/\\/g, "");
        nitro.log("[wideiptv] Found fallback m3u8: " + streamUrl);
        return {
            url: streamUrl,
            headers: {
                "Referer": "https://" + domain + "/",
                "Origin": "https://" + domain,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
        };
    }

    nitro.error("[wideiptv] Could not extract m3u8 stream");
    return null;
}
