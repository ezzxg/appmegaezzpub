async function extract(url) {
    if (url.startsWith('//')) {
        url = 'https:' + url;
    }

    // Le añadimos los parámetros de autostart a la URL original
    var targetUrl = url + (url.includes('?') ? '&' : '?') + 'autostart=1&autoplay=1';

    // Delegamos la extracción directamente al WebView Nativo de la app.
    // ¿Por qué esto es mejor?
    // Porque en el código Kotlin nativo de la app (NitroScriptEngine.kt), 
    // "jnbhi.com" ya está en la lista negra estricta de 'shouldOverrideUrlLoading'.
    // Al usar el motor nativo, la app aniquilará a jnbhi.com automáticamente
    // antes de que pueda hacer un reload o redirección.
    nitro.webViewExtract(targetUrl);

    // Retornamos el modo webview para que el reproductor espere el stream interceptado
    return { type: 'webview_mode' };
}
