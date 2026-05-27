/**
 * [v55.13.4] Driver Nitro Cloud: HgLink v2 (Estabilizado)
 */
async function extract(url) {
    nitro.log("🔍 Nitro Driver Cloud: HgLink v2 (Identidad Nativa) activado");
    
    // 1. Intentar rastreo recursivo (misma lógica que local)
    const result = await followRecursive(url, 0);
    if (result) return result;
    
    // 2. Si falla el rastreo, caza de mirrors en paralelo
    nitro.log("⚡ Rastreo directo falló. Iniciando caza de mirrors...");
    const mirrors = [
        "hanerix.com", "audinifer.com", "vibuxer.com", 
        "masukestin.com", "strwish.com", "streamwish.to"
    ];
    
    const videoCode = url.includes('/e/') ? 
                      url.split('/e/')[1].split('?')[0].split('/')[0] : 
                      url.split('/').pop().split('?')[0];

    // Probamos mirrors (secuencial rápido o podrías usar Promise.any)
    for (const mirror of mirrors) {
        const mirrorUrl = `https://${mirror}/e/${videoCode}`;
        nitro.log(`🔎 Probando espejo: ${mirrorUrl}`);
        
        const html = nitro.fetch(mirrorUrl, JSON.stringify({
            "Referer": url,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        }));

        if (html) {
            const found = findStream(html, mirrorUrl);
            if (found) return found;
        }
    }

    return null;
}

async function followRecursive(url, depth) {
    if (depth > 4) return null;
    
    nitro.log(`🔍 Salto ${depth}: ${url}`);
    const html = nitro.fetch(url, JSON.stringify({
        "Referer": "https://hglink.to/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    }));

    if (!html) return null;

    // A. Buscar video directamente
    const found = findStream(html, url);
    if (found) return found;

    // B. Buscar redirección JS
    const jsRedirMatch = html.match(/(?:window|location|top)(?:\['location'\])?(?:\['href'\]|\.href)\s*=\s*['"]([^'"]+)['"]/);
    if (jsRedirMatch) {
        let nextUrl = jsRedirMatch[1];
        if (nextUrl.startsWith("/")) {
            const domain = url.split('/').slice(0, 3).join('/');
            nextUrl = domain + nextUrl;
        }
        return await followRecursive(nextUrl, depth + 1);
    }
    
    return null;
}

function findStream(html, currentUrl) {
    // 1. Buscar Packer
    const packerRegex = /eval\s*\(\s*function\s*\(p\s*,\s*a\s*,\s*c\s*,\s*k\s*[,e\s*|,\s*d\s*]*\).*?\}\s*\(\s*['"](.*?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"](.*?)['"]\.split\(['"]\|['"]\)/;
    const pMatch = html.match(packerRegex);
    if (pMatch) {
        try {
            const unpacked = nitro.unpack(pMatch[1], parseInt(pMatch[2]), JSON.stringify(pMatch[4].split('|')));
            const m3u8Match = unpacked.match(/(https?:\/\/[^"']+\.(?:m3u8|txt|urlset)[^"']*)/);
            if (m3u8Match) return buildSource(m3u8Match[1], currentUrl);
        } catch (e) {}
    }

    // 2. Buscar directo
    const directMatch = html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|txt|urlset)[^"']*)["']/i);
    if (directMatch) return buildSource(directMatch[1], currentUrl);

    return null;
}

function buildSource(streamUrl, referer) {
    return {
        url: streamUrl.replace(/\\\//g, "/"),
        headers: {
            "Referer": referer,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Origin": "https://minochinos.com",
            "Sec-Fetch-Dest": "video",
            "Sec-Fetch-Mode": "cors"
        }
    };
}
