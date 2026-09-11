async function extract(url) {
    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://sensa.com.ar/",
        "Origin": "https://sensa.com.ar/",
        "Accept": "*/*",
        "Connection": "keep-alive"
    };

    const responseJson = nitro.fetchFull(url, "GET", null, JSON.stringify(HEADERS));
    const response = JSON.parse(responseJson || "{}");
    const status = response.status;
    const body = response.body || "";

    if (status === 200 && body.includes("#EXTM3U")) {
        return {
            url: url,
            headers: HEADERS
        };
    }
    return null;
}