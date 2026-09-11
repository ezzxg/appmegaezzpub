async function extract(url) {
    // Extraer video ID de URLs como youtube.com/@eldoce/live o youtube.com/watch?v=XXX
    let videoId = null;
    const idMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (idMatch) { videoId = idMatch[1]; }
    else {
        // Buscar en /@user/live → fetchear la página para conseguir el video ID
        const pageResp = nitro.fetchFull(url, "GET", null, JSON.stringify({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }));
        const page = (JSON.parse(pageResp || "{}").body || "");
        const vidMatch = page.match(/videoId['"]\s*:\s*['"]([a-zA-Z0-9_-]{11})['"]/);
        if (vidMatch) videoId = vidMatch[1];
    }
    if (!videoId) return null;

    // Fetchear la página del video para obtener ytInitialPlayerResponse
    const watchUrl = "https://www.youtube.com/watch?v=" + videoId;
    const resp = nitro.fetchFull(watchUrl, "GET", null, JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }));
    const html = (JSON.parse(resp || "{}").body || "");

    // Extraer ytInitialPlayerResponse
    const prMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var|<\/script)/s);
    if (!prMatch) return null;

    try {
        const pr = JSON.parse(prMatch[1]);
        const streaming = pr.streamingData;
        if (!streaming) return null;

        // PRIORIDAD 1: serverAbrStreamingUrl (muxed audio+video, ideal para ExoPlayer)
        if (streaming.serverAbrStreamingUrl) {
            return {
                url: streaming.serverAbrStreamingUrl,
                headers: {}
            };
        }

        // PRIORIDAD 2: adaptiveFormats - buscar video 720p/1080p mp4 (sin audio)
        const adaptive = streaming.adaptiveFormats;
        if (adaptive && adaptive.length) {
            const video = adaptive.find(f => f.itag === 136) || adaptive.find(f => f.itag === 137) || adaptive.find(f => f.itag === 135);
            if (video && video.url) {
                return {
                    url: video.url,
                    headers: {}
                };
            }
        }
    } catch(e) {}
    return null;
}