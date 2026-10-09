/**
 * Nitro Driver para Yandex.Disk (disk.yandex.com / disk.yandex.ru / yadi.sk) — VOD
 * PAGINAS DE ARCHIVO PUBLICO (disk.yandex.com/i/..., yadi.sk/i/...) -> HLS
 *
 * La página de archivo público de Yandex.Disk trae embebido en el HTML estático
 * el master-playlist.m3u8 y las variantes 240p/360p/480p/720p/1080p
 * (streaming.disk.yandex.net/hls/...). No hace falta dar play ni ejecutar JS.
 *
 * Se prefiere el master-playlist (trae todas las calidades, ExoPlayer elige la
 * mejor sola; arranca ~480p y sube a 1080p a los ~8s con la estrategia adaptativa).
 * Si no existe master, se elige la variante de mayor resolución disponible.
 *
 * Los enlaces WRAPPER tipo workers.dev/?url=... NO los maneja este script:
 * van a yandexfile.js (extractor separado, ver nitro_config.json).
 *
 * Si la página no es video (imagen o carpeta) devuelve null -> fallback a extractores nativos.
 */
async function extract(url) {
    nitro.log("🔍 [yandexdisk] Iniciando extracción para: " + url);

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    const REFERER = "https://disk.yandex.com/";

    const pageJson = nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": UA,
        "Referer": REFERER,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }));

    let page = null;
    try { page = JSON.parse(pageJson || "{}"); } catch (e) {}
    if (!page || !page.body) {
        nitro.log("❌ [yandexdisk] Sin HTML (status " + (page ? page.status : "?") + ")");
        nitro.onResult(JSON.stringify(null));
        return null;
    }
    if (page.status === 404) {
        nitro.log("❌ [yandexdisk] Archivo eliminado o enlace muerto (404)");
        nitro.onResult(JSON.stringify(null));
        return null;
    }

    // Limpieza: escapados \/ (JS/JSON embebido) y &amp; (HTML) — las URLs actuales no llevan query, por las dudas.
    let html = page.body.replace(/\\\//g, "/").replace(/&amp;/g, "&");

    // 1) Preferir el master-playlist (une todas las calidades).
    let m3u8 = null;
    const masterMatch = html.match(/https:\/\/[^"'\s<>\\]+\/master-playlist\.m3u8/);
    if (masterMatch) {
        m3u8 = masterMatch[0];
        nitro.log("🎯 [yandexdisk] master-playlist encontrado");
    }

    // 2) Fallback: elegir la variante de mayor resolución (1080p > 720p > 480p > 360p > 240p > cualquier m3u8).
    if (!m3u8) {
        const all = html.match(/https:\/\/[^"'\s<>\\]+\/\d{3,4}p\/playlist\.m3u8/g) || [];
        const any = html.match(/https:\/\/[^"'\s<>\\]+\.m3u8/g) || [];
        const candidates = all.length ? all : any;
        if (candidates.length) {
            const prefs = ["1080p", "720p", "480p", "360p", "240p"];
            m3u8 = candidates[0];
            for (let i = 0; i < prefs.length; i++) {
                const hit = candidates.find(function (c) { return c.indexOf("/" + prefs[i] + "/") !== -1; });
                if (hit) { m3u8 = hit; break; }
            }
            nitro.log("🎯 [yandexdisk] Variante elegida por resolución");
        }
    }

    if (!m3u8 || m3u8.indexOf("http") !== 0) {
        nitro.log("⚠️ [yandexdisk] No se encontró m3u8 en la página (¿imagen/carpeta?)");
        nitro.onResult(JSON.stringify(null));
        return null;
    }

    const result = {
        url: m3u8,
        headers: {
            "User-Agent": UA,
            "Referer": REFERER
        }
    };

    nitro.log("✅ [yandexdisk] Extracción exitosa: " + m3u8);
    nitro.onResult(JSON.stringify(result));
    return result;
}
