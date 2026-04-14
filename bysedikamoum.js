/**
 * [v55.15.0] Driver Nitro Cloud: Bysedikamoum (Infinity Engine)
 */
async function extract(url) {
    nitro.log("🚀 Iniciando Infinity Handshake para: " + url);
    
    const videoCode = url.includes('/e/') ? 
                      url.split('/e/')[1].split('?')[0].split('/')[0] : 
                      url.split('/').pop().split('?')[0];

    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    const headers = { 
        "User-Agent": userAgent,
        "Referer": "https://bysedikamoum.com/",
        "X-Embed-Parent": url
    };

    try {
        // 1. Obtener Detalles
        nitro.log("Step 1: Fetching Details...");
        const detailsResp = JSON.parse(nitro.fetchFull(`https://bysedikamoum.com/api/videos/${videoCode}/embed/details`, JSON.stringify(headers)));
        if (detailsResp.status !== 200) {
            nitro.log("❌ Error en Detalles: Status " + detailsResp.status + " - " + detailsResp.body);
            return null;
        }
        
        const details = JSON.parse(detailsResp.body);
        const embedFrameUrl = details.embed_frame_url || `https://f75s.com/wxx/${videoCode}`;
        const frameDomain = embedFrameUrl.split('/')[2];
        nitro.log("✅ Detalles OK. Frame Domain: " + frameDomain);

        // 2. Obtener Desafío
        nitro.log("Step 2: Fetching Challenge...");
        const challengeResp = JSON.parse(nitro.fetchFull(`https://${frameDomain}/api/videos/access/challenge`, JSON.stringify({
            "User-Agent": userAgent,
            "Referer": embedFrameUrl,
            "Origin": `https://${frameDomain}`
        })));
        
        if (challengeResp.status !== 200) {
            nitro.log("❌ Error en Challenge: Status " + challengeResp.status);
            return null;
        }
        
        const challenge = JSON.parse(challengeResp.body);
        const nonce = challenge.nonce;
        nitro.log("✅ Challenge OK. Nonce: " + nonce.substring(0, 10) + "...");

        // 3. Handshake Criptográfico NATIVO (ECDSA)
        nitro.log("Step 3: Crypto Signature (Nativo)...");
        const cryptoResult = JSON.parse(nitro.cryptoAttest(nonce));
        
        // 4. Atestación (Attest)
        nitro.log("Step 4: Sending Attestation...");
        const attestBody = {
            viewer_id: "87ec78e6e2f840e484f9332c5ed9d8fd",
            device_id: "zA7vTYZbJTsMdZixs3Eqog",
            challenge_id: challenge.challenge_id,
            nonce: nonce,
            signature: cryptoResult.signature,
            public_key: {
                crv: "P-256", ext: true, key_ops: ["verify"], kty: "EC",
                x: cryptoResult.x, y: cryptoResult.y
            },
            client: { user_agent: userAgent, platform: "Windows" }
        };

        const tokenResp = JSON.parse(nitro.fetchFull(`https://${frameDomain}/api/videos/access/attest`, JSON.stringify({
            "User-Agent": userAgent,
            "Referer": embedFrameUrl,
            "Origin": `https://${frameDomain}`,
            "Content-Type": "application/json"
        })));
        // Nota: El puente fetchFull actual solo soporta GET. Usaremos fetchPost para el resto.
        
        const tokenJson = nitro.fetchPost(`https://${frameDomain}/api/videos/access/attest`, JSON.stringify(attestBody), JSON.stringify({
            "User-Agent": userAgent,
            "Referer": embedFrameUrl,
            "Origin": `https://${frameDomain}`
        }));
        
        const tokenData = JSON.parse(tokenJson);
        if (!tokenData.token) {
            nitro.log("❌ Error en Attest: No se recibió token. Respuesta: " + tokenJson);
            return null;
        }
        const token = tokenData.token;
        nitro.log("✅ Attest OK. Token generado.");

        // 5. Playback y Desencriptación
        nitro.log("Step 5: Final Playback Link...");
        const playbackBody = { fingerprint: { token: token, viewer_id: attestBody.viewer_id, device_id: attestBody.device_id } };
        const playbackJson = nitro.fetchPost(`https://${frameDomain}/api/videos/${videoCode}/embed/playback`, JSON.stringify(playbackBody), JSON.stringify({
            "User-Agent": userAgent,
            "Referer": embedFrameUrl,
            "Origin": `https://${frameDomain}`
        }));
        
        const pbData = JSON.parse(playbackJson).playback;
        
        if (pbData.payload && pbData.iv) {
            nitro.log("Step 6: Native Decryption...");
            const decrypted = nitro.cryptoDecrypt(pbData.payload2 || pbData.payload, pbData.decrypt_keys.edge_1 || pbData.decrypt_keys.edge_2, pbData.iv2 || pbData.iv);
            
            if (decrypted) {
                const finalUrl = JSON.parse(decrypted).file;
                nitro.log("🎉 Extracción exitosa!");
                return { url: finalUrl, headers: { "Referer": `https://${frameDomain}/` } };
            }
        }
    } catch (e) {
        nitro.log("❌ Error Crítico en Driver: " + e.message);
    }
    return null;
}
