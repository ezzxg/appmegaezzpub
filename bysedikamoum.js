/**
 * [v55.15.1] Driver Nitro Cloud: Bysedikamoum (Stealth Engine)
 */
async function extract(url) {
    nitro.log("🚀 Iniciando Stealth Handshake para: " + url);
    
    // Generadores de Identidad Dinámica para evitar bloqueos
    const viewerId = generateHex(32);
    const deviceId = generateBase64(22);
    
    const videoCode = url.includes('/e/') ? 
                      url.split('/e/')[1].split('?')[0].split('/')[0] : 
                      url.split('/').pop().split('?')[0];

    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    
    // Cabeceras base de sigilo
    const baseHeaders = {
        "User-Agent": userAgent,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-Viewer-Id": viewerId,
        "X-Device-Id": deviceId
    };

    try {
        // 1. Obtener Detalles
        nitro.log("Step 1: Fetching Details...");
        const detailsResp = JSON.parse(nitro.fetchFull(`https://bysedikamoum.com/api/videos/${videoCode}/embed/details`, JSON.stringify({
            ...baseHeaders,
            "Referer": "https://bysedikamoum.com/",
            "X-Embed-Parent": url
        })));
        
        if (detailsResp.status !== 200) {
            nitro.log("❌ Error en Detalles: " + detailsResp.status);
            return null;
        }
        
        const details = JSON.parse(detailsResp.body);
        const embedFrameUrl = details.embed_frame_url || `https://f75s.com/wxx/${videoCode}`;
        const frameDomain = embedFrameUrl.split('/')[2];
        const frameOrigin = `https://${frameDomain}`;

        // 2. Obtener Desafío
        nitro.log("Step 2: Fetching Challenge...");
        const challengeResp = JSON.parse(nitro.fetchFull(`${frameOrigin}/api/videos/access/challenge`, JSON.stringify({
            ...baseHeaders,
            "Referer": embedFrameUrl,
            "Origin": frameOrigin
        })));
        
        if (challengeResp.status !== 200) {
            nitro.log("❌ Error en Challenge: " + challengeResp.status);
            return null;
        }
        
        const challenge = JSON.parse(challengeResp.body);
        const nonce = challenge.nonce;

        // 3. Handshake ECDSA Nativo
        nitro.log("Step 3: Crypto Signature...");
        const cryptoResult = JSON.parse(nitro.cryptoAttest(nonce));
        
        // 4. Atestación (POST)
        nitro.log("Step 4: Sending Attestation...");
        const attestBody = {
            viewer_id: viewerId,
            device_id: deviceId,
            challenge_id: challenge.challenge_id,
            nonce: nonce,
            signature: cryptoResult.signature,
            public_key: {
                crv: "P-256", ext: true, key_ops: ["verify"], kty: "EC",
                x: cryptoResult.x, y: cryptoResult.y
            },
            client: { user_agent: userAgent, platform: "Windows" }
        };

        const tokenJson = nitro.fetchPost(`${frameOrigin}/api/videos/access/attest`, JSON.stringify(attestBody), JSON.stringify({
            ...baseHeaders,
            "Referer": embedFrameUrl,
            "Origin": frameOrigin,
            "Content-Type": "application/json"
        }));
        
        const tokenData = JSON.parse(tokenJson);
        if (!tokenData.token) {
            nitro.log("❌ Error en Attest: " + tokenJson);
            return null;
        }
        const token = tokenData.token;

        // 5. Playback Final
        nitro.log("Step 5: Playback Stealth Fetch...");
        const playbackBody = { 
            fingerprint: { 
                token: token, 
                viewer_id: viewerId, 
                device_id: deviceId 
            } 
        };
        
        const playbackJson = nitro.fetchPost(`${frameOrigin}/api/videos/${videoCode}/embed/playback`, JSON.stringify(playbackBody), JSON.stringify({
            ...baseHeaders,
            "Referer": embedFrameUrl,
            "Origin": frameOrigin,
            "Content-Type": "application/json"
        }));
        
        const pbData = JSON.parse(playbackJson).playback;
        
        if (pbData && pbData.payload) {
            nitro.log("Step 6: Native Decryption...");
            const decrypted = nitro.cryptoDecrypt(
                pbData.payload2 || pbData.payload, 
                pbData.decrypt_keys.edge_1 || pbData.decrypt_keys.edge_2, 
                pbData.iv2 || pbData.iv
            );
            
            if (decrypted) {
                const finalUrl = JSON.parse(decrypted).file;
                nitro.log("🎉 ¡Éxito! Video extraído bajo el radar.");
                return { url: finalUrl, headers: { "Referer": frameOrigin + "/" } };
            }
        }
    } catch (e) {
        nitro.log("❌ Error en Stealth Driver: " + e.message);
    }
    return null;
}

// Helpers para identidad dinámica
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
