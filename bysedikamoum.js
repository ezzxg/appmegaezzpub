/**
 * [v55.15.5] Driver Nitro Cloud: Bysedikamoum (Session Aware)
 * Fix: Precise Referer/Origin alignment & Sec-Fetch headers
 */
async function extract(url) {
    nitro.log("🚀 Iniciando Handshake v3 (Referer Fixed) para: " + url);
    
    const viewerId = generateHex(32);
    const deviceId = generateBase64(22);
    const videoCode = url.includes('/e/') ? 
                      url.split('/e/')[1].split('?')[0].split('/')[0] : 
                      url.split('/').pop().split('?')[0];

    // User Agent robusto
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
    
    const urlParts = url.split('/');
    const mainOrigin = urlParts[0] + "//" + urlParts[2];

    const baseHeaders = {
        "User-Agent": userAgent,
        "Accept": "application/json, text/plain, */*",
        "X-Viewer-Id": viewerId,
        "X-Device-Id": deviceId,
        "X-Requested-With": "XMLHttpRequest",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty"
    };

    let sessionCookies = "";

    try {
        // 1. Detalles (GET)
        nitro.log("Step 1: Fetching Details...");
        const detailsResp = JSON.parse(nitro.fetchFull(`${mainOrigin}/api/videos/${videoCode}/embed/details`, "GET", null, JSON.stringify({
            ...baseHeaders,
            "Referer": url,
            "Origin": mainOrigin,
            "Sec-Fetch-Site": "same-origin"
        })));
        
        if (detailsResp.status !== 200) {
            nitro.log("❌ Details Failed: " + detailsResp.status + " Body: " + detailsResp.body);
            return null;
        }
        
        const details = JSON.parse(detailsResp.body);
        const embedFrameUrl = details.embed_frame_url || `https://f75s.com/e/${videoCode}`;
        const frameOrigin = `https://${embedFrameUrl.split('/')[2]}`;
        
        nitro.log("Step 1 Success. Frame Origin: " + frameOrigin);

        // 2. Desafío (GET)
        nitro.log("Step 2: Fetching Challenge...");
        const challengeResp = JSON.parse(nitro.fetchFull(`${frameOrigin}/api/videos/access/challenge`, "GET", null, JSON.stringify({
            ...baseHeaders,
            "Referer": embedFrameUrl,
            "Origin": frameOrigin,
            "Sec-Fetch-Site": "same-origin"
        })));
        
        if (challengeResp.status !== 200) return null;
        const challenge = JSON.parse(challengeResp.body);

        // 3. Firma ECDSA
        const cryptoResult = JSON.parse(nitro.cryptoAttest(challenge.nonce));
        
        // 4. Atestación (POST)
        nitro.log("Step 4: Sending Attestation...");
        const attestBody = {
            viewer_id: viewerId, device_id: deviceId,
            challenge_id: challenge.challenge_id, nonce: challenge.nonce,
            signature: cryptoResult.signature,
            public_key: {
                crv: "P-256", ext: true, key_ops: ["verify"], kty: "EC",
                x: cryptoResult.x, y: cryptoResult.y
            },
            client: { user_agent: userAgent, platform: "Windows" }
        };

        const attestResp = JSON.parse(nitro.fetchFull(`${frameOrigin}/api/videos/access/attest`, "POST", JSON.stringify(attestBody), JSON.stringify({
            ...baseHeaders,
            "Referer": embedFrameUrl,
            "Origin": frameOrigin,
            "Content-Type": "application/json",
            "Sec-Fetch-Site": "same-origin"
        })));
        
        if (attestResp.status !== 200) {
            nitro.log("❌ Attest Failed: " + attestResp.status);
            return null;
        }

        const tokenData = JSON.parse(attestResp.body);
        if (!tokenData.token) return null;

        // Extraer cookies (Set-Cookie)
        if (attestResp.headers && attestResp.headers["Set-Cookie"]) {
            sessionCookies = attestResp.headers["Set-Cookie"];
            nitro.log("🌐 Session Cookie captured!");
        }

        // 5. Playback Final (POST)
        // REGLA DE ORO: El Playback se hace DESDE el Frame (f75s.com) hacia f75s.com
        nitro.log("Step 5: Playback Final Request...");
        const playbackBody = { fingerprint: { token: tokenData.token, viewer_id: viewerId, device_id: deviceId } };
        
        const pbResp = JSON.parse(nitro.fetchFull(`${frameOrigin}/api/videos/${videoCode}/embed/playback`, "POST", JSON.stringify(playbackBody), JSON.stringify({
            ...baseHeaders,
            "Referer": embedFrameUrl, // REFERER TIENE QUE SER EL FRAME
            "Origin": frameOrigin,    // ORIGIN TIENE QUE SER EL FRAME (Same-Origin)
            "Content-Type": "application/json",
            "Cookie": sessionCookies,
            "Sec-Fetch-Site": "same-origin"
        })));
        
        if (pbResp.status !== 200) {
            nitro.log("❌ Playback Final Failed: " + pbResp.status + " Body: " + pbResp.body);
            // Intento desesperado: Cambiar a cross-origin si falló el same-origin
            nitro.log("Step 5b: Retry with Parent Identity...");
            const pbResp2 = JSON.parse(nitro.fetchFull(`${frameOrigin}/api/videos/${videoCode}/embed/playback`, "POST", JSON.stringify(playbackBody), JSON.stringify({
                ...baseHeaders,
                "Referer": url, // Parent URL
                "Origin": mainOrigin, // Parent Origin
                "Content-Type": "application/json",
                "Cookie": sessionCookies,
                "Sec-Fetch-Site": "cross-site"
            })));
            
            if (pbResp2.status !== 200) return null;
            return processPlayback(pbResp2.body, frameOrigin);
        }

        return processPlayback(pbResp.body, frameOrigin);

    } catch (e) {
        nitro.log("❌ Extractor Error: " + e.message);
    }
    return null;
}

function processPlayback(body, frameOrigin) {
    const pbData = JSON.parse(body).playback;
    if (pbData && (pbData.payload || pbData.payload2)) {
        nitro.log("Step 6: Decrypting...");
        const decrypted = nitro.cryptoDecrypt(
            pbData.payload2 || pbData.payload, 
            pbData.decrypt_keys.edge_1 || pbData.decrypt_keys.edge_2, 
            pbData.iv2 || pbData.iv
        );
        
        if (decrypted) {
            const finalUrl = JSON.parse(decrypted).file;
            nitro.log("🎉 SUCCESS! Playback URL secured.");
            return { url: finalUrl, headers: { "Referer": frameOrigin + "/" } };
        }
    }
    return null;
}

function generateHex(len) {
    const chars = "0123456789abcdef";
    let res = "";
    for(let i=0; i<len; i++) res += chars[Math.floor(Math.random()*16)];
    return res;
}

function generateBase64(len) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let res = "";
    for(let i=0; i<len; i++) res += chars[Math.floor(Math.random()*chars.length)];
    return res;
}
