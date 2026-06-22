const crypto = require("crypto");
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY } = process.env;

module.exports = async (req, res) => {
    // 1. Nur POST erlauben
    if (req.method !== 'POST') return res.status(405).send("Method not allowed");

    const { id, content } = req.body;
    if (!id || !content) return res.status(400).send("Fehlende Daten");

    try {
        // 2. Webhook aus Supabase holen
        const response = await fetch(`${SUPABASE_URL}/rest/v1/webhooks?id=eq.${id}`, {
            headers: { 
                "apikey": SUPABASE_SERVICE_ROLE_KEY, 
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` 
            }
        });
        
        const data = await response.json();
        if (!data || data.length === 0) return res.status(404).send("Webhook nicht gefunden");

        // 3. Entschlüsseln
        const buffer = Buffer.from(data[0].webhook_enc, 'base64');
        const iv = buffer.subarray(0, 12);
        const tag = buffer.subarray(12, 28);
        const encrypted = buffer.subarray(28);
        
        const key = crypto.createHash("sha256").update(String(ENCRYPTION_KEY)).digest();
        
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        const webhookUrl = decrypted.toString('utf8');

        // 4. An Discord senden
        const discordRes = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(content) // Hier das content-Objekt (z.B. { embeds: [...] })
        });

        if (!discordRes.ok) throw new Error("Discord API Fehler: " + discordRes.status);

        res.status(200).send("Erfolgreich an Discord weitergeleitet!");

    } catch (err) {
        console.error("Fehler im Proxy:", err);
        res.status(500).json({ error: err.message });
    }
};
