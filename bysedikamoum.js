/**
 * [v55.15.4] Driver Nitro Cloud: Bysedikamoum (Session Aware)
 * Fix: 403 Domain Block Bypass
 */
async function extract(url) {
    nitro.log("🚀 Iniciando Handshake v2 (Session Aware) para: " + url);
    
    const viewerId = generateHex(32);
    const deviceId = generateBase64(22);
    const videoCode = url.includes('/e/') ? 
                      url.split('/e/')[1].split('?')[0].split('/')[0] : 
                      url.split('/').pop().split('?')[0];

    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    
    // Extraer el origen real (ej: https://bysedikamoum.com)
    const urlParts = url.split('/');
    const mainOrigin = urlParts[0] + "//" + urlParts[2];

    const baseHeaders = {
        "User-Agent": userAgent,
        "Accept": "application/json, text/plain, */*",
        "X-Viewer-Id": viewerId,
        "X-Device-Id": deviceId,
        "Origin": mainOrigin,
        "Referer": url
    };

    let sessionCookies = "";

    try {
        // 1. Detalles (GET)
        nitro.log("Step 1: Fetching Details...");
        const detailsResp = JSON.parse(nitro.fetchFull(`${mainOrigin}/api/videos/${videoCode}/embed/details`, "GET", null, JSON.stringify({
            ...baseHeaders,
            "X-Embed-Parent": url
        })));
        
        if (detailsResp.status !== 200) {
            nitro.log("❌ Details Failed: " + detailsResp.status);
            return null;
        }
        
        const details = JSON.parse(detailsResp.body);
        const embedFrameUrl = details.embed_frame_url || `https://f75s.com/wxx/${videoCode}`;
        const frameOrigin = `https://${embedFrameUrl.split('/')[2]}`;

        // 2. Desafío (GET)
        nitro.log("Step 2: Fetching Challenge...");
        const challengeResp = JSON.parse(nitro.fetchFull(`${frameOrigin}/api/videos/access/challenge`, "GET", null, JSON.stringify({
            ...baseHeaders,
            "Referer": embedFrameUrl // El desafío se pide desde el frame
        })));
        
        if (challengeResp.status !== 200) return null;
        const challenge = JSON.parse(challengeResp.body);

        // 3. Firma ECDSA
        const cryptoResult = JSON.parse(nitro.cryptoAttest(challenge.nonce));
        
        // 4. Atestación (POST)
        nitro.log("Step 4: Sending Attestation & Capturing Session...");
        const attestBody = {
            viewer_id: viewerId,
            device_id: deviceId,
            challenge_id: challenge.challenge_id,
            nonce: challenge.nonce,
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
            "Content-Type": "application/json"
        })));
        
        if (attestResp.status !== 200) {
            nitro.log("❌ Attest Failed: " + attestResp.status);
            return null;
        }

        const tokenData = JSON.parse(attestResp.body);
        if (!tokenData.token) return null;

        // Extraer cookies
        if (attestResp.headers && attestResp.headers["Set-Cookie"]) {
            sessionCookies = attestResp.headers["Set-Cookie"];
            nitro.log("🌐 Session Cookie captured!");
        }

        // 5. Playback Final (POST) - AQUÍ ES DONDE SPOOFEAMOS AL MÁXIMO
        nitro.log("Step 5: Playback Final Request...");
        const playbackBody = { fingerprint: { token: tokenData.token, viewer_id: viewerId, device_id: deviceId } };
        
        const pbResp = JSON.parse(nitro.fetchFull(`${frameOrigin}/api/videos/${videoCode}/embed/playback`, "POST", JSON.stringify(playbackBody), JSON.stringify({
            ...baseHeaders,
            "Referer": url, // Usamos el Referer ORIGINAL del sitio principal
            "Origin": mainOrigin, // Usamos el Origin ORIGINAL
            "Content-Type": "application/json",
            "Cookie": sessionCookies
        })));
        
        if (pbResp.status !== 200) {
            nitro.log("❌ Playback Final Failed: " + pbResp.status + " Body: " + pbResp.body);
            return null;
        }

        const pbData = JSON.parse(pbResp.body).playback;
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
                return { url: finalUrl, headers: { "Referer": mainOrigin + "/" } };
            }
        }
    } catch (e) {
        nitro.log("❌ Stealth Driver v2 Error: " + e.message);
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
