async function extract(url) {
    // Fetch YouTube page with mobile UA to get hlsManifestUrl
    const pageResp = nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Accept-Language": "es-419,es;q=0.9"
    }));
    
    const page = (JSON.parse(pageResp || "{}").body || "");
    const status = JSON.parse(pageResp || "{}").status || 0;
    
    nitro.log("YouTube: page status=" + status + " length=" + page.length);
    
    if (status !== 200 || !page) {
        nitro.log("YouTube: page fetch failed");
        return null;
    }
    
    // Extract hlsManifestUrl from ytInitialPlayerResponse
    const hlsMatch = page.match(/"hlsManifestUrl"\s*:\s*"([^"]+)"/);
    if (hlsMatch) {
        const hlsUrl = hlsMatch[1].replace(/\\u0026/g, "&");
        nitro.log("YouTube: HLS URL found, length=" + hlsUrl.length);
        return {
            url: hlsUrl,
            headers: {
                "User-Agent": "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
                "Referer": "https://www.youtube.com/",
                "Origin": "https://www.youtube.com"
            }
        };
    }
    
    // Fallback: extract from adaptiveFormats (for some live streams)
    const adaptiveMatch = page.match(/"adaptiveFormats"\s*:\s*\[([^\]]+)\]/);
    if (adaptiveMatch) {
        const formats = adaptiveMatch[1];
        // Look for HLS format
        const hlsFormat = formats.match(/"mimeType"\s*:\s*"application\/vnd\.apple\.mpegurl"[^}]*"url"\s*:\s*"([^"]+)"/);
        if (hlsFormat) {
            const hlsUrl = hlsFormat[1].replace(/\\u0026/g, "&");
            nitro.log("YouTube: HLS from adaptiveFormats");
            return {
                url: hlsUrl,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
                    "Referer": "https://www.youtube.com/",
                    "Origin": "https://www.youtube.com"
                }
            };
        }
    }
    
    nitro.log("YouTube: no HLS found in page");
    return null;
}
