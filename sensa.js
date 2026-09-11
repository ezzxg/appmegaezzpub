async function extract(url) {
    const resp = nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://megaezz.site/",
        "Origin": "https://megaezz.site"
    }));
    const html = (JSON.parse(resp || "{}").body || "");
    const m = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i);
    if (m) {
        return {
            url: m[0].replace(/\\/g, "/").replace(/['";\s]/g, ""),
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://megaezz.site/",
                "Origin": "https://megaezz.site"
            }
        };
    }
    return null;
}