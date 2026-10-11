/**
 * Nitro Driver para VOE (voe.sx / mirrors tipo megankiddifference.com) — VOD
 * EMBEDS /e/<id>
 *
 * VOE actualmente pone un gate ALTCHA (proof-of-work PBKDF2/SHA-256, sin imágenes)
 * antes del player. El widget es AUTOMÁTICO: resuelve el PoW con WebCrypto del
 * navegador y autoenvía el form (form.submit() en el evento 'verified'). El PoW
 * NO se puede resolver desde fetchFull porque:
 *   (a) about:blank no tiene crypto.subtle (contexto no seguro) y
 *   (b) el puente nitro no expone PBKDF2 (solo hash/HMAC), y un PBKDF2 de
 *       10.000 iteraciones x ~256 intentos por JNI sería inviable.
 *
 * Por eso este driver usa el MODO WEBVIEW del motor Nitro:
 *   1. nitro.onResult({headers}) -> registra Referer/UA para el m3u8 que
 *      capturará el interceptor de red del motor.
 *   2. nitro.webViewExtract(url) -> la WebView invisible carga el embed; la
 *      página de voe.sx redirige al mirror actual (JS location.href), ALTCHA
 *      resuelve solo, el form se autoenvía y el clicker del motor toca Play;
 *      el interceptor .m3u8 captura el stream y completa la extracción.
 *   3. return { type: 'webview_mode' } -> IMPORTANTE: NO devolver null ni
 *      llamar onResult(null), porque completaría el deferred con null y
 *      abortaría la espera del interceptor.
 *
 * Tras la primera solución, VOE guarda permanentToken (localStorage) y las
 * cargas siguientes del mismo WebView saltan el gate.
 *
 * Ventana disponible: el pipeline VOD limita Nitro a ~45s
 * (VodExtractionEngine.withTimeoutOrNull(45000)).
 */
async function extract(url) {
    nitro.log("🔍 [voe] Modo WebView para: " + url);

    nitro.onResult(JSON.stringify({
        headers: {
            "Referer": url,
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36"
        }
    }));

    nitro.webViewExtract(url);
    return { type: "webview_mode" };
}
