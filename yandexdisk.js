/**
 * Nitro Driver para Yandex.Disk (disk.yandex.com / disk.yandex.ru / yadi.sk) — VOD
 * PAGINAS DE ARCHIVO PUBLICO (disk.yandex.com/i/..., yadi.sk/i/...) -> ARCHIVO DIRECTO
 *
 * v2 — STREAM DIRECTO (botón Download):
 * La extracción de m3u8 (HLS) de la página dejó de funcionar. Con User-Agent móvil
 * (Chrome Android) la página muestra un botón "Download" que, al hacer click, llama a
 * la API pública de Yandex:
 *   GET https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=<url>
 * y responde JSON { "method": "GET", "href": "<URL directa>" } que apunta al archivo
 * completo (downloader.disk.yandex.ru -> 302 -> storage.yandex.net/rdisk/...).
 * Esa URL soporta Range/seek (206, video/x-matroska, Accept-Ranges: bytes) y ExoPlayer
 * la reproduce directo (igual que yandexfile.js con archivos MKV).
 *
 * Flujo: página con UA móvil (valida 404) -> cloud-api download -> href directo.
 * Fallback: si la API no devuelve href, se intenta el m3u8 embebido en el HTML.
 * Si no hay nada -> null -> fallback a extractores nativos.
 *
 * Los enlaces WRAPPER tipo workers.dev/?url=... NO los maneja este script:
 * van a yandexfile.js (extractor separado, ver nitro_config.json).
 */

function resolveDirectDownload(publicKey, html, ua) {
    const candidates = [publicKey];
    // short_url del dueño (https://yadi.sk/i/...) como clave alternativa si la URL larga falla.
    const shortMatch = html.match(/"short_url"\s*:\s*"(https:\/\/yadi\.sk\/i\/[^"]+)"/);
    if (shortMatch && candidates.indexOf(shortMatch[1]) === -1) {
        candidates.push(shortMatch[1]);
    }

    for (let i = 0; i < candidates.length; i++) {
        const api = "https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=" + encodeURIComponent(candidates[i]);
        const respJson = nitro.fetchFull(api, "GET", null, JSON.stringify({
            "User-Agent": ua,
            "Accept": "application/json"
        }));

        let resp = null;
        try { resp = JSON.parse(respJson || "{}"); } catch (e) {}
        if (!resp || resp.status !== 200 || !resp.body) {
            nitro.log("⚠️ [yandexdisk] cloud-api status " + (resp ? resp.status : "?") + " (candidate " + i + ")");
            continue;
        }

        let data = null;
        try { data = JSON.parse(resp.body); } catch (e) {}
        if (data && data.href && data.href.indexOf("http") === 0) {
            return data.href;
        }
        nitro.log("⚠️ [yandexdisk] cloud-api sin href en la respuesta");
    }
    return null;
}

async function extract(url) {
    nitro.log("🔍 [yandexdisk] Iniciando extracción para: " + url);

    // UA móvil (Chrome Android): es el que muestra el botón Download en la página.
    const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36";
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

    // Limpieza: escapados \/ (JS/JSON embebido) y &amp; (HTML).
    const html = page.body.replace(/\\\//g, "/").replace(/&amp;/g, "&");

    // ===== 1) RUTA PRINCIPAL: link directo del botón Download (API pública de Yandex) =====
    const directUrl = resolveDirectDownload(url, html, UA);
    if (directUrl) {
        const result = {
            url: directUrl,
            headers: {
                "User-Agent": UA,
                "Referer": REFERER
            }
        };
        nitro.log("✅ [yandexdisk] Link directo obtenido: " + directUrl.substring(0, 140) + "...");
        nitro.onResult(JSON.stringify(result));
        return result;
    }

    // ===== 2) FALLBACK: m3u8 embebido en el HTML (por si la API no aplica y el HLS vuelve) =====
    let m3u8 = null;
    const masterMatch = html.match(/https:\/\/[^"'\s<>\\]+\/master-playlist\.m3u8/);
    if (masterMatch) {
        m3u8 = masterMatch[0];
        nitro.log("🎯 [yandexdisk] master-playlist encontrado (fallback)");
    }

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
            nitro.log("🎯 [yandexdisk] Variante elegida por resolución (fallback)");
        }
    }

    if (!m3u8 || m3u8.indexOf("http") !== 0) {
        nitro.log("⚠️ [yandexdisk] Sin link directo ni m3u8 (¿imagen/carpeta?)");
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

    nitro.log("✅ [yandexdisk] Extracción exitosa (m3u8 fallback): " + m3u8);
    nitro.onResult(JSON.stringify(result));
    return result;
}
