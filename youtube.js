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

    // Buscar hlsManifestUrl directamente en el HTML (más confiable que parsear el JSON completo)
    const hlsMatch = html.match(/"hlsManifestUrl"\s*:\s*"([^"]+)"/);
    if (hlsMatch) {
        const hlsUrl = hlsMatch[1].replace(/\\u0026/g, "&");
        return {
            url: hlsUrl,
            headers: {}
        };
    }

    // Fallback: intentar extraer ytInitialPlayerResponse completo
    const prMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var|<\/script)/s);
    if (prMatch) {
        try {
            const pr = JSON.parse(prMatch[1]);
            const streaming = pr.streamingData;
            if (streaming && streaming.hlsManifestUrl) {
                return {
                    url: streaming.hlsManifestUrl,
                    headers: {}
                };
            }
        } catch(e) {}
    }
    return null;
}