async function extract(url) {
    let videoId = null;
    const idMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (idMatch) { videoId = idMatch[1]; }
    else {
        const pageResp = nitro.fetchFull(url, "GET", null, JSON.stringify({
            "User-Agent": "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        }));
        const page = (JSON.parse(pageResp || "{}").body || "");
        const vidMatch = page.match(/videoId['"]\s*:\s*['"]([a-zA-Z0-9_-]{11})['"]/);
        if (vidMatch) videoId = vidMatch[1];
    }
    if (!videoId) return null;

    const watchUrl = "https://www.youtube.com/watch?v=" + videoId;
    const resp = nitro.fetchFull(watchUrl, "GET", null, JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    }));
    const html = (JSON.parse(resp || "{}").body || "");

    const hlsMatch = html.match(/"hlsManifestUrl"\s*:\s*"([^"]+)"/);
    if (hlsMatch) {
        let hlsUrl = hlsMatch[1].replace(/\\u0026/g, "&");
        nitro.log("YouTube HLS URL: " + hlsUrl.substring(0, 200));
        return {
            url: hlsUrl,
            headers: {
                "Referer": "https://www.youtube.com/",
                "Origin": "https://www.youtube.com"
            }
        };
    }

    return null;
}