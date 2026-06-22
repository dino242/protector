const crypto = require("crypto");
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY } = process.env;

module.exports = async (req, res) => {
  // Kein manuelles JSON.parse, Vercel macht das bei JSON-Content-Type automatisch
  const { owner_discord_id, webhook_url } = req.body;

  if (!owner_discord_id || !webhook_url) {
    return res.status(400).json({ 
      error: "Daten fehlen",
      debug: { owner_discord_id, webhook_url }
    });
  }

  // Verschlüsselung bleibt gleich
  const key = crypto.createHash("sha256").update(String(ENCRYPTION_KEY)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(webhook_url, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const webhook_enc = Buffer.concat([iv, tag, enc]).toString("base64");

  const id = "wh_" + crypto.randomBytes(9).toString("hex");

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/webhooks`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({ id, owner_discord_id: String(owner_discord_id), webhook_enc }),
  });

  const data = await resp.json();
  if (resp.ok) res.status(200).json({ id });
  else res.status(500).json({ error: "Supabase Fehler", details: data });
};
