async function extract(url) {
    nitro.webViewExtract(url);
    return { type: 'webview_mode' };
}
