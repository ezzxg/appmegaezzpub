async function extract(url) {
    nitro.log("🔍 Nitro Driver Cloud: HgLink activado");
    
    let html = nitro.fetch(url);
    if(!html) return null;
    
    // 1. Intentar rastro por main.js
    let mainJsMatch = html.match(/src=["'](\/js\/main\.js\?v=[\d.]+)["']/);
    if (mainJsMatch) {
       let jsUrl = "https://hglink.to" + mainJsMatch[1];
       let jsContent = nitro.fetch(jsUrl);
       let redirectMatch = jsContent.match(/https?:\/\/[a-z0-9]+\.[a-z0-9]+\.[a-z]+\/e\/[a-zA-Z0-9]+/g);
       
       if (redirectMatch && redirectMatch.length > 0) {
           let jumpUrl = redirectMatch[0];
           nitro.log("✅ Salto detectado -> " + jumpUrl);
           let jumpHtml = nitro.fetch(jumpUrl);
           let m3u8Match = jumpHtml.match(/https?:\/\/[^"']+\.m3u8[^"']*/);
           if (m3u8Match) {
               return { url: m3u8Match[0].replace(/\\/g, ""), headers: { "Referer": jumpUrl } };
           }
       }
    }
    
    // 2. Caza de Espejos (Mirrors)
    let code = url.split('/').pop();
    let servers = ["hanerix.com", "audinifer.com", "vibuxer.com", "masukestin.com", "premilkyway.com"];
    for (let s of servers) {
        let trialUrl = "https://" + s + "/e/" + code;
        nitro.log("🔎 Probando espejo: " + trialUrl);
        let mHtml = nitro.fetch(trialUrl);
        let m3Match = mHtml.match(/https?:\/\/[^"']+\.m3u8[^"']*/);
        if (m3Match) {
            return { url: m3Match[0].replace(/\\/g, ""), headers: { "Referer": trialUrl } };
        }
    }
    return null;
}
