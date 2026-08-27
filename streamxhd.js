/**
 * Nitro Driver para streamxhd.com (live1.php?stream={canal})
 *
 * Flujo:
 *   URL canal (resolve_url) = https://streamxhd.com/live1.php?stream={canal}
 *   La página contiene un playbackURL ofuscado:
 *
 *     var playbackURL="", VA=[[idx,"base64"],...];
 *     VA.sort((a,b)=>a[0]-b[0]);
 *     var k=F1()+F2();
 *     VA.forEach(e=>{ playbackURL += String.fromCharCode(parseInt(atob(e[1]).replace(/\D/g,''))-k) });
 *     function F1(){return N1;}  function F2(){return N2;}
 *
 *   → k = N1+N2. Cada base64 decodifica a algo como "sV764209vl"; se le quitan
 *     los no-dígitos → entero; entero - k = código de carácter ascii.
 *
 *   Los nombres de variable (VA) y de funciones (F1/F2) se RANDOMIZAN en cada
 *   request, así que se extraen dinámicamente por regex (no hardcode).
 *
 *   La URL resultante es "https://host/global/{canal}/index.m3u8?ip=...&token=..."
 *   y hace 302 a otro CDN. El token va atado a la IP del solicitante → como
 *   nitro.fetchFull() corre en el propio dispositivo, el token es válido para
 *   esa IP automáticamente.
 *
 *   Referer: the final m3u8 CDN mountains don't need it, but se manda el de
 *   streamxhd por seguridad (no rompe nada para la cadena 302).
 */

async function extract(url) {
    return await _streamxhd_extract(url);
}

function _decodeStreamxhd(html) {
    // 1. Localizar el bloque playbackURL con nombres dinámicos
    const m = html.match(/var playbackURL="",\s*(\w+)=\[([\s\S]*?)\];\s*\1\.sort\(\(a,b\)=>a\[0\]-b\[0\]\);\s*var\s+k=(\w+)\(\)\+(\w+)\(\);/);
    if (!m) return null;

    const arrStr = m[2];
    const fn1 = m[3];
    const fn2 = m[4];

    // 2. Extraer pares [idx, "base64"]
    const pairs = [];
    const re = /\[(\d+),["']([A-Za-z0-9+/=]+)["']\]/g;
    let mb;
    while ((mb = re.exec(arrStr)) !== null) {
        pairs.push([parseInt(mb[1], 10), mb[2]]);
    }
    pairs.sort(function (a, b) { return a[0] - b[0]; });

    // 3. Sumar las dos funciones clave
    const f1v = html.match(new RegExp("function\\s+" + fn1 + "\\(\\)\\{return (\\d+);\\}"));
    const f2v = html.match(new RegExp("function\\s+" + fn2 + "\\(\\)\\{return (\\d+);\\}"));
    if (!f1v || !f2v) return null;
    const k = parseInt(f1v[1], 10) + parseInt(f2v[1], 10);

    // 4. Construir la URL
    let out = "";
    for (var i = 0; i < pairs.length; i++) {
        const bin = atob(pairs[i][1]);
        const num = parseInt(bin.replace(/\D/g, ""), 10);
        out += String.fromCharCode(num - k);
    }
    if (!/^https?:/.test(out)) return null;
    return out;
}

async function _streamxhd_extract(url) {
    nitro.log("🔍 [StreamXHD] Iniciando extracción para: " + url);

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    // Host del sitio para el Referer
    let siteHost = "streamxhd.com";
    try {
        const h = url.match(/https?:\/\/([^\/]+)/);
        if (h) siteHost = h[1];
    } catch (e) {}

    // 1. FETCH de la página
    const pageJson = nitro.fetchFull(url, "GET", null, JSON.stringify({
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
    }));

    let pageHtml = "";
    try { pageHtml = JSON.parse(pageJson || "{}").body || ""; } catch (e) {}
    if (!pageHtml) { nitro.log("❌ [StreamXHD] No se obtuvo la página"); nitro.onResult(JSON.stringify(null)); return null; }

    // 2. Decodificar playbackURL ofuscado
    const m3u8Url = _decodeStreamxhd(pageHtml);
    if (!m3u8Url) { nitro.log("❌ [StreamXHD] No se pudo decodificar playbackURL"); nitro.onResult(JSON.stringify(null)); return null; }
    nitro.log("🎯 [StreamXHD] m3u8 decodificado: " + m3u8Url);

    // 3. Devolver URL + headers
    const result = {
        url: m3u8Url,
        headers: {
            "User-Agent": UA,
            "Referer": "https://" + siteHost + "/"
        }
    };
    nitro.log("✅ [StreamXHD] Extracción exitosa");
    nitro.onResult(JSON.stringify(result));
    return result;
}

// AUTO-EJECUCIÓN (ver streamtp.js)
(function () {
    try {
        if (typeof __nitro_target_url !== 'undefined' && __nitro_target_url) {
            _streamxhd_extract(__nitro_target_url).catch(function (e) {
                nitro.log("❌ [StreamXHD Auto] Error: " + e.message);
                nitro.onResult(JSON.stringify(null));
            });
        }
    } catch (e) {}
})();
