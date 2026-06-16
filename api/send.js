const crypto = require('crypto');
const axios = require('axios');

function decryptPayload(encryptedData, password) {
    try {
        const key = crypto.scryptSync(password, 'salt_baba', 32);
        const [ivHex, encryptedHex, authTagHex] = encryptedData.split(':');
        
        if (!ivHex || !encryptedHex || !authTagHex) return null;

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (e) {
        return null;
    }
}

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { username, executor, inventoryData, encryptedWebhook } = req.body;
    const masterKey = "BABA";

    const realWebhookUrl = decryptPayload(encryptedWebhook, masterKey);

    if (!realWebhookUrl || !realWebhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        return res.status(400).json({ 
            error: "Invalid or manipulated payload",
            debug: realWebhookUrl ? "URL-Format falsch" : "Entschlüsselung fehlgeschlagen"
        });
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
