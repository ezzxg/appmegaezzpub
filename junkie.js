async function extract(url) {
    return new Promise((resolve, reject) => {
        // En lugar de usar webViewExtract (que activa el auto-clicker bugeado de NitroScriptEngine)
        // o document.write (que rompe las políticas CORS de JWPlayer y causa cuelgues),
        // cargamos el reproductor en un iframe puro a pantalla completa.
        
        const iframe = document.createElement('iframe');
        
        // Añadimos parámetros para forzar el autoplay en caso de que el iframe lo requiera
        const finalUrl = url + (url.includes('?') ? '&' : '?') + 'autoplay=1&autostart=1&mute=0';
        iframe.src = finalUrl;
        
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.setAttribute('allow', 'autoplay; fullscreen');
        
        // [NUEVO] El atributo sandbox es la CLAVE contra jnbhi.com.
        // Permitimos scripts y el mismo origen (para JWPlayer), pero NO permitimos 
        // 'allow-top-navigation' ni 'allow-popups'. 
        // Esto BLOQUEA COMPLETAMENTE que el script de publicidad refresque o redirija la página!
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
        
        document.body.style.margin = '0';
        document.body.style.backgroundColor = '#000';
        document.body.appendChild(iframe);
        
        // Como el Android WebView de MegaezzTV tiene mediaPlaybackRequiresUserGesture = false,
        // el JWPlayer (que es de TV en vivo) hará autoplay automáticamente dentro del iframe.
        // Al reproducirse, el motor nativo (shouldInterceptRequest) capturará el .m3u8 en segundo plano.
        
        setTimeout(() => {
            reject("Timeout: El servidor no respondió con un M3U8 o bloqueó el Autoplay.");
        }, 35000); // 35 segundos de tiempo de espera
    });
}
