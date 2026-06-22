const crypto = require("crypto");
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY } = process.env;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send("Method not allowed");

  const { id, content } = req.body;

  // 1. Webhook aus Supabase holen
  const response = await fetch(`${SUPABASE_URL}/rest/v1/webhooks?id=eq.${id}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const data = await response.json();
  if (!data || data.length === 0) return res.status(404).send("Webhook nicht gefunden");

  // 2. Entschlüsseln
  const buffer = Buffer.from(data[0].webhook_enc, 'base64');
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const key = crypto.createHash("sha256").update(String(ENCRYPTION_KEY)).digest();
  
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const webhookUrl = decipher.update(encrypted) + decipher.final('utf8');

  // 3. An Discord senden
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });

  res.status(200).send("Nachricht gesendet!");
};
