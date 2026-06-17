const axios = require('axios');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { username, executor, inventoryData, webhookUrl } = req.body;

    if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        return res.status(400).json({ error: "Unauthorized endpoint call" });
    }

    try {
        await axios.post(webhookUrl, {
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
