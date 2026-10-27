async function extract(url) {
    nitro.log("[la18hd] Starting extraction for: " + url);
    
    let domain = "la18hd.su";
    try {
        let parsed = new URL(url);
        domain = parsed.hostname;
    } catch(e) {}

    // Cabeceras estilo navegacion top-level: la18hd.su devuelve 403 sin Sec-Fetch-*
    let headers = JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": "https://" + domain + "/",
        "Origin": "https://" + domain,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
    });

    let respJson = nitro.fetchFull(url, "GET", null, headers);
    if (!respJson) {
        nitro.error("[la18hd] Empty response from fetchFull");
        return null;
    }

    let resp;
    try {
        resp = JSON.parse(respJson);
    } catch(e) {
        nitro.error("[la18hd] Failed to parse response JSON");
        return null;
    }

    if (!resp.body) {
        nitro.error("[la18hd] Response body is empty");
        return null;
    }

    let html = resp.body;
    nitro.log("[la18hd] HTML length: " + html.length);

    // Extraer m3u8 del JSON inline (player clappr): "src":"https://...m3u8?token=..."
    let m3u8Match = html.match(/"src"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/i) ||
                    html.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i) ||
                    html.match(/source\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i) ||
                    html.match(/file\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i) ||
                    html.match(/src\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);

    if (m3u8Match && m3u8Match[1]) {
        let streamUrl = m3u8Match[1].replace(/\\/g, "");
        nitro.log("[la18hd] Found direct m3u8/source: " + streamUrl);
        return {
            url: streamUrl,
            headers: {
                "Referer": "https://" + domain + "/",
                "Origin": "https://" + domain,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
        };
    }

    // Fallback: iframe
    let iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch && iframeMatch[1]) {
        let iframeUrl = iframeMatch[1];
        if (iframeUrl.startsWith("//")) {
            iframeUrl = "https:" + iframeUrl;
        } else if (iframeUrl.startsWith("/")) {
            iframeUrl = "https://" + domain + iframeUrl;
        }
        nitro.log("[la18hd] Found iframe: " + iframeUrl);

        let iframeHeaders = JSON.stringify({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Referer": url,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1"
        });

        let iframeRespJson = nitro.fetchFull(iframeUrl, "GET", null, iframeHeaders);
        if (iframeRespJson) {
            try {
                let iResp = JSON.parse(iframeRespJson);
                let iHtml = iResp.body || "";
                let iM3u8Match = iHtml.match(/"src"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/i) ||
                                 iHtml.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i) ||
                                 iHtml.match(/source\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i) ||
                                 iHtml.match(/file\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
                if (iM3u8Match && iM3u8Match[1]) {
                    let streamUrl = iM3u8Match[1].replace(/\\/g, "");
                    nitro.log("[la18hd] Found m3u8 in iframe: " + streamUrl);
                    let iParsed = new URL(iframeUrl);
                    return {
                        url: streamUrl,
                        headers: {
                            "Referer": "https://" + iParsed.hostname + "/",
                            "Origin": "https://" + iParsed.hostname,
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
                        }
                    };
                }
            } catch(e) {}
        }
    }

    nitro.error("[la18hd] Could not extract m3u8 stream");
    return null;
}
