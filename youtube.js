async function extract(url) {
    // Paso 1: Obtener visitorData de la página
    const pageResp = nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    }));
    const page = (JSON.parse(pageResp || "{}").body || "");

    const vdMatch = page.match(/"visitorData"\s*:\s*"([^"]+)"/);
    if (!vdMatch) { nitro.log("YouTube: no visitorData"); return null; }
    const visitorData = vdMatch[1];

    // Paso 2: Extraer videoId si es /@user/live
    let videoId = null;
    const idMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (idMatch) { videoId = idMatch[1]; }
    else {
        const vidMatch = page.match(/videoId['"]\s*:\s*['"]([a-zA-Z0-9_-]{11})['"]/);
        if (vidMatch) videoId = vidMatch[1];
    }
    if (!videoId) { nitro.log("YouTube: no videoId"); return null; }

    // Paso 3: Llamar a InnerTube API con visitorData
    const payload = JSON.stringify({
        videoId: videoId,
        context: {
            client: {
                clientName: "WEB",
                clientVersion: "2.20260911.01.00",
                visitorData: visitorData,
                hl: "es",
                gl: "AR"
            }
        },
        playbackContext: {
            contentPlaybackContext: {
                html5Preference: "HTML5_PREF_WANTS"
            }
        }
    });

    const apiResp = nitro.fetchFull(
        "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
        "POST",
        payload,
        JSON.stringify({
            "User-Agent": "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            "Content-Type": "application/json; charset=UTF-8",
            "Origin": "https://www.youtube.com",
            "Referer": "https://www.youtube.com/",
            "X-YouTube-Client-Name": "1",
            "X-YouTube-Client-Version": "2.20260911.01.00"
        })
    );

    const apiData = JSON.parse((JSON.parse(apiResp || "{}").body || "{}"));

    if (apiData.streamingData && apiData.streamingData.hlsManifestUrl) {
        nitro.log("YouTube InnerTube HLS OK");
        return {
            url: apiData.streamingData.hlsManifestUrl,
            headers: {
                "Referer": "https://www.youtube.com/",
                "Origin": "https://www.youtube.com"
            }
        };
    }

    nitro.log("YouTube InnerTube status: " + (apiData.playabilityStatus ? apiData.playabilityStatus.status : "unknown"));
    return null;
}