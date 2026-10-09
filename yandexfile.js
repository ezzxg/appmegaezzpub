/**
 * Nitro Driver Yandex FILE — VOD
 * MANEJA EXCLUSIVAMENTE WRAPPERS QUE REDIRIGEN A UN ARCHIVO DIRECTO
 * (p. ej. https://xxx.workers.dev/?url=https://disk.yandex.com/i/...)
 *
 * IMPORTANTE: las páginas directas https://disk.yandex.com/i/... y https://yadi.sk/i/...
 * NO pasan por aquí — van a yandexdisk.js (extractor separado, ver nitro_config.json).
 *
 * Flujo del wrapper:
 *   1. NUNCA hacer fetch completo de la URL: el destino es el archivo original (p. ej. 10GB .mkv)
 *      y cargarlo en memoria revienta la app (OutOfMemoryError).
 *   2. Se sondea con "Range: bytes=0-1". El wrapper conserva el Range en su 302 y el storage
 *      de Yandex responde 206 con 2 bytes (VERIFICADO: content-type video/x-matroska,
 *      Content-Range: bytes 0-1/10349035478 → seek soportado).
 *   3. Si el destino es video → se devuelve la MISMA URL del wrapper como archivo directo:
 *      ExoPlayer la pide (302 fresco en cada request y cada seek) y streamea el MKV
 *      progresivo con Range. El extractor NO baja ni un byte del archivo.
 *   4. Si el destino es HTML (wrapper hacia una página) → se extrae el m3u8 de ese HTML
 *      (misma preferencia master-playlist que yandexdisk.js).
 *
 * Devuelve null si no hay ni archivo ni m3u8 (fallback a extractores nativos).
 */
async function extract(url) {
    nitro.log("🔍 [yandexfile] Extracción de wrapper para: " + url);

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

    // Misma preferencia que yandexdisk.js: master > variante de mayor resolución.
    function pickHls(body) {
        if (!body) return null;
        const html = String(body).replace(/\\\//g, "/").replace(/&amp;/g, "&");

        const master = html.match(/https:\/\/[^"'\s<>\\]+\/master-playlist\.m3u8/);
        if (master) {
            nitro.log("🎯 [yandexfile] master-playlist encontrado");
            return master[0];
        }

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
            nitro.log("🎯 [yandexfile] Variante elegida: ..." + best.substring(best.length - 45));
            return best;
        }
        return null;
    }

    function fail(why) {
        nitro.log("⚠️ [yandexfile] Sin resultado: " + why);
        nitro.onResult(JSON.stringify(null));
        return null;
    }

    // Sonda segura: solo 2 bytes. El Range llega al destino final vía el 302 del wrapper.
    const probe = fetchObj(nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": UA,
        "Range": "bytes=0-1",
        "Referer": REFERER
    })));
    if (!probe) return fail("sonda sin respuesta");

    const ct = headerOf(probe, "content-type").toLowerCase();
    const status = probe.status;
    nitro.log("🧪 [yandexfile] Sonda: status=" + status + " ct=" + ct);

    const isFile = status !== 404 && (
        ct.indexOf("video/") !== -1 ||
        ct.indexOf("application/octet-stream") !== -1 ||
        ct.indexOf("matroska") !== -1 ||
        (status === 206 && ct.indexOf("text/html") === -1 && ct.indexOf("json") === -1)
    );

    if (isFile) {
        // Archivo directo (mkv/mp4...): devolvemos la MISMA URL del wrapper.
        // ExoPlayer la sigue con 302 fresco en cada request/seek y usa Range → seek OK.
        nitro.log("🎬 [yandexfile] Archivo directo detectado → URL wrapper para el reproductor");
        const result = { url: url, headers: { "User-Agent": UA } };
        nitro.onResult(JSON.stringify(result));
        return result;
    }

    if (status === 404) return fail("404");

    // No es video: debería ser HTML (wrapper hacia una página con m3u8).
    let body = probe.body;
    if (status === 206) {
        // El servidor hizo caso omiso del Range y devolvió HTML parcial → repetir sin Range.
        nitro.log("🔄 [yandexfile] 206, re-fetch sin Range");
        const full = fetchObj(nitro.fetchFull(url, "GET", null, JSON.stringify({
            "User-Agent": UA,
            "Referer": REFERER,
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"
        })));
        if (full && full.body) body = full.body;
    }

    const m3u8 = pickHls(body);
    if (m3u8 && m3u8.indexOf("http") === 0) {
        const result = { url: m3u8, headers: { "User-Agent": UA, "Referer": REFERER } };
        nitro.log("✅ [yandexfile] Extracción HLS desde wrapper: " + m3u8);
        nitro.onResult(JSON.stringify(result));
        return result;
    }
    return fail("ni archivo ni m3u8 (ct=" + ct + ")");
}
