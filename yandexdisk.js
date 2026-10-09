/**
 * Nitro Driver para Yandex.Disk (disk.yandex.com / disk.yandex.ru / yadi.sk) — VOD
 * v2 — Soporta DOS tipos de enlace:
 *
 * (A) Páginas de archivo público (disk.yandex.*/i/..., yadi.sk/i/...) → HLS:
 *     La página trae embebido en el HTML el master-playlist.m3u8 y las variantes
 *     240p..1080p (streaming.disk.yandex.net/hls/...). No hace falta dar play.
 *     Devuelve el MASTER (eligió ExoPlayer la mejor calidad sola; arranca ~480p y sube a 1080p).
 *
 * (B) Wrappers de archivo directo (p. ej. workers.dev/?url=... que hacen 302 al .mkv original):
 *     NUNCA hacer fetch del wrapper sin Range: el destino es el archivo COMPLETO (p.ej. 10GB)
 *     y body.string() en memoria revienta (OutOfMemoryError no atrapada).
 *     Se sondea con "Range: bytes=0-1" → el wrapper conserva el Range en el redirect y el
 *     storage de Yandex responde 206 con 2 bytes (VERIFICADO: content-type video/x-matroska).
 *     Si el destino es video → se devuelve la MISMA URL del wrapper como archivo directo:
 *     ExoPlayer la sigue (302 en cada request, token fresco) con soporte de Range → seek OK.
 *
 * Verificado en vivo (20/10/2026):
 *   - master-playlist → 200; variante 720p → 200 (EXT-X-PLAYLIST-TYPE:VOD); segmento .ts → 200.
 *   - worker ?url= → 302 → storage.yandex.net/rdisk/... con Range → 206 bytes 0-1/10349035478.
 *
 * Fallback: si la página no es video (imagen/carpeta) o nada coincide → null
 * (ExtractorRegistry no reintenta, VOD cae al WebView como último recurso).
 */
async function extract(url) {
    nitro.log("🔍 [yandexdisk] Extracción para: " + url);

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    const REFERER = "https://disk.yandex.com/";

    function fetchObj(raw) {
        try { return JSON.parse(raw || "{}"); } catch (e) { return null; }
    }

    function headerOf(resp, name) {
        try {
            const h = resp.headers || {};
            const lower = name.toLowerCase();
            for (const k in h) { if (k.toLowerCase() === lower) return String(h[k]); }
        } catch (e) {}
        return "";
    }

    // Extrae el mejor m3u8 de un HTML/JSON recibido. Devuelve URL o null.
    function pickHls(body) {
        if (!body) return null;
        // Limpieza: escapados \/ (JS/JSON embebido) y &amp; (HTML)
        const html = String(body).replace(/\\\//g, "/").replace(/&amp;/g, "&");

        // 1) Preferir master-playlist (une todas las calidades).
        const master = html.match(/https:\/\/[^"'\s<>\\]+\/master-playlist\.m3u8/);
        if (master) {
            nitro.log("🎯 [yandexdisk] master-playlist encontrado");
            return master[0];
        }

        // 2) Fallback: variante de mayor resolución (1080p > 720p > 480p > 360p > 240p).
        const all = html.match(/https:\/\/[^"'\s<>\\]+\/\d{3,4}p\/playlist\.m3u8/g) || [];
        const any = html.match(/https:\/\/[^"'\s<>\\]+\.m3u8/g) || [];
        const candidates = all.length ? all : any;
        if (candidates.length) {
            const prefs = ["1080p", "720p", "480p", "360p", "240p"];
            let best = candidates[0];
            for (let i = 0; i < prefs.length; i++) {
                const hit = candidates.find(function (c) { return c.indexOf("/" + prefs[i] + "/") !== -1; });
                if (hit) { best = hit; break; }
            }
            nitro.log("🎯 [yandexdisk] Variante elegida: " + best.substring(best.length - 40));
            return best;
        }
        return null;
    }

    function ok(m3u8) {
        const result = {
            url: m3u8,
            headers: { "User-Agent": UA, "Referer": REFERER }
        };
        nitro.log("✅ [yandexdisk] Extracción HLS: " + m3u8);
        nitro.onResult(JSON.stringify(result));
        return result;
    }

    function fail(why) {
        nitro.log("⚠️ [yandexdisk] Sin resultado: " + why);
        nitro.onResult(JSON.stringify(null));
        return null;
    }

    // ¿Es una página de Yandex directa (no un wrapper)? Solo si la URL COMIENZA en
    // el host de Yandex y no trae un parámetro ?url= embebido.
    const isYandexPage = /^https?:\/\/(disk\.yandex\.(com|ru|eu)|yadi\.sk)\/(i|d)\//.test(url) && !/[?&]url=/.test(url);

    if (isYandexPage) {
        // --- CASO A: página preview → HTML completo (sin Range, ya probado en v1) ---
        const page = fetchObj(nitro.fetchFull(url, "GET", null, JSON.stringify({
            "User-Agent": UA,
            "Referer": REFERER,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        })));
        if (!page || !page.body) return fail("sin HTML (status " + (page ? page.status : "?") + ")");
        if (page.status === 404) return fail("404, archivo eliminado");
        const m3u8 = pickHls(page.body);
        return m3u8 ? ok(m3u8) : fail("no hay m3u8 (¿imagen/carpeta?)");
    }

    // --- CASO B: wrapper / desconocido → sonda con Range (nunca fetch completo) ---
    const probe = fetchObj(nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": UA,
        "Range": "bytes=0-1",
        "Referer": REFERER
    })));
    if (!probe) return fail("sonda sin respuesta");

    const ct = headerOf(probe, "content-type").toLowerCase();
    const status = probe.status;
    nitro.log("🧪 [yandexdisk] Sonda: status=" + status + " ct=" + ct);

    const isFile = ct.indexOf("video/") !== -1 ||
                   ct.indexOf("application/octet-stream") !== -1 ||
                   ct.indexOf("matroska") !== -1 ||
                   (status === 206 && ct.indexOf("text/html") === -1 && ct.indexOf("json") === -1);

    if (isFile && status !== 404) {
        // Archivo directo (mkv/mp4...). Devolvemos la MISMA URL: el wrapper hace 302
        // fresco en cada request de ExoPlayer y el Range del reproductor llega al destino.
        nitro.log("🎬 [yandexdisk] Archivo directo detectado (" + (ct || "sin ct") + ") → URL wrapper");
        const result = { url: url, headers: { "User-Agent": UA } };
        nitro.onResult(JSON.stringify(result));
        return result;
    }

    if (status === 404) return fail("404");

    // No es video: el body debería ser HTML (wrapper → página o página directa).
    let body = probe.body;
    // Si el servidor hizo caso omiso del Range devolviendo HTML PARCIAL (206), repetimos sin Range.
    if (status === 206 && pickHls(body) === null) {
        nitro.log("🔄 [yandexdisk] 206 parcial, re-fetch sin Range");
        const full = fetchObj(nitro.fetchFull(url, "GET", null, JSON.stringify({
            "User-Agent": UA,
            "Referer": REFERER,
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"
        })));
        if (full && full.body) body = full.body;
    }

    const m3u8 = pickHls(body);
    return m3u8 ? ok(m3u8) : fail("ni archivo ni m3u8 (ct=" + ct + ")");
}
