/**
 * [v55.16.0] Driver Nitro Cloud: Bysedikamoum (Perfect Session)
 * Fix: Native Cookie Cleaner + JS Session Persistence
 */
async function extract(url) {
    nitro.log("🚀 Iniciando Handshake v4 (Perfect Session) para: " + url);
    
    const viewerId = generateHex(32);
    const deviceId = generateBase64(22);
    const videoCode = url.includes('/e/') ? 
                      url.split('/e/')[1].split('?')[0].split('/')[0] : 
                      url.split('/').pop().split('?')[0];

    // User Agent coincidente con el motor del usuario
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    
    const urlParts = url.split('/');
    const mainOrigin = urlParts[0] + "//" + urlParts[2];

    const session = {
        cookies: "",
        update(resp) {
            if (resp.headers && resp.headers["Set-Cookie"]) {
                const newCookies = resp.headers["Set-Cookie"];
                if (!this.cookies) {
                    this.cookies = newCookies;
                } else {
                    // Mezclar manteniendo unicidad básico (la limpieza real ocurre en el motor nativo)
                    this.cookies += "; " + newCookies;
                }
                nitro.log("🌐 Session Updated: " + this.cookies.substring(0, 30) + "...");
            }
        }
    };

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

    try {
        // 1. Detalles (GET)
        nitro.log("Step 1: Fetching Details...");
        const detailsResp = JSON.parse(nitro.fetchFull(`${mainOrigin}/api/videos/${videoCode}/embed/details`, "GET", null, JSON.stringify({
            ...baseHeaders,
            "Referer": url,
            "Origin": mainOrigin
        })));
        
        if (detailsResp.status !== 200) {
            nitro.log("❌ Details Failed: " + detailsResp.status);
            return null;
        }
        
        session.update(detailsResp);
        const details = JSON.parse(detailsResp.body);
        const embedFrameUrl = details.embed_frame_url || `https://f75s.com/e/${videoCode}`;
        const frameOrigin = `https://${embedFrameUrl.split('/')[2]}`;

        // 2. Desafío (GET)
        nitro.log("Step 2: Fetching Challenge...");
        const challengeResp = JSON.parse(nitro.fetchFull(`${frameOrigin}/api/videos/access/challenge`, "GET", null, JSON.stringify({
            ...baseHeaders,
            "Referer": embedFrameUrl,
            "Origin": frameOrigin,
            "Cookie": session.cookies
        })));
        
        if (challengeResp.status !== 200) return null;
        session.update(challengeResp);
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
            "Cookie": session.cookies
        })));
        
        if (attestResp.status !== 200) return null;
        session.update(attestResp);
        const tokenData = JSON.parse(attestResp.body);
        if (!tokenData.token) return null;

        // 5. Playback Final (POST)
        nitro.log("Step 5: Playback Final Request...");
        const playbackBody = { fingerprint: { token: tokenData.token, viewer_id: viewerId, device_id: deviceId } };
        
        const pbResp = JSON.parse(nitro.fetchFull(`${frameOrigin}/api/videos/${videoCode}/embed/playback`, "POST", JSON.stringify(playbackBody), JSON.stringify({
            ...baseHeaders,
            "Referer": embedFrameUrl,
            "Origin": frameOrigin,
            "Content-Type": "application/json",
            "Cookie": session.cookies
        })));
        
        if (pbResp.status !== 200) {
            nitro.log("❌ Playback Failed: " + pbResp.status + " Body: " + pbResp.body);
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
                return { url: finalUrl, headers: { "Referer": frameOrigin + "/" } };
            }
        }
    } catch (e) {
        nitro.log("❌ Extractor Error: " + e.message);
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
