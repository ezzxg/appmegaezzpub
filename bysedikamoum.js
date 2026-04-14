/**
 * [v55.14.1] Driver Nitro Cloud: Bysedikamoum (Handshake Seguro)
 */
async function extract(url) {
    nitro.log("🔍 Nitro Driver: Bysedikamoum v1 iniciado");
    
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
        const detailsJson = nitro.fetch(`https://bysedikamoum.com/api/videos/${videoCode}/embed/details`, JSON.stringify(headers));
        const details = JSON.parse(detailsJson);
        const embedFrameUrl = details.embed_frame_url || `https://f75s.com/wxx/${videoCode}`;
        const frameDomain = embedFrameUrl.split('/')[2];

        // 2. Obtener Desafío (Challenge)
        const challengeJson = nitro.fetchPost(`https://${frameDomain}/api/videos/access/challenge`, "{}", JSON.stringify({
            "User-Agent": userAgent,
            "Referer": embedFrameUrl,
            "Origin": `https://${frameDomain}`
        }));
        const challenge = JSON.parse(challengeJson);
        const nonce = challenge.nonce;

        // 3. Handshake Criptográfico NATIVO (v55.14.1)
        const cryptoResult = JSON.parse(nitro.cryptoAttest(nonce));
        
        // 4. Atestación (Attest)
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

        const tokenJson = nitro.fetchPost(`https://${frameDomain}/api/videos/access/attest`, JSON.stringify(attestBody), JSON.stringify({
            "User-Agent": userAgent,
            "Referer": embedFrameUrl
        }));
        const token = JSON.parse(tokenJson).token;

        // 5. Playback y Desencriptación NATIVA
        const playbackBody = { fingerprint: { token: token, viewer_id: attestBody.viewer_id, device_id: attestBody.device_id } };
        const playbackJson = nitro.fetchPost(`https://${frameDomain}/api/videos/${videoCode}/embed/playback`, JSON.stringify(playbackBody), JSON.stringify({
            "User-Agent": userAgent,
            "Referer": embedFrameUrl
        }));
        
        const pbData = JSON.parse(playbackJson).playback;
        
        // Intentar desencriptar payload 1
        if (pbData.payload && pbData.iv) {
            // Reconstruir key de los key_parts
            let keyHex = ""; // Nota: En la APK lo hacemos binario, aquí pedimos ayuda al puente
            // Para simplificar, usamos el puente de desencriptación robusto que ya maneja los payloads
            const decrypted = nitro.cryptoDecrypt(pbData.payload2 || pbData.payload, pbData.decrypt_keys.edge_1 || pbData.decrypt_keys.edge_2, pbData.iv2 || pbData.iv);
            
            if (decrypted) {
                const finalUrl = JSON.parse(decrypted).file;
                return { url: finalUrl, headers: { "Referer": `https://${frameDomain}/` } };
            }
        }
    } catch (e) {
        nitro.log("❌ Error en handshake Bysedikamoum: " + e.message);
    }
    return null;
}
