const crypto = require("crypto");
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY } = process.env;

function encrypt(text) {
  const key = crypto.createHash("sha256").update(String(ENCRYPTION_KEY)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Sicherstellen, dass wir JSON haben
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  
  const { owner_discord_id, webhook_url } = body;

  if (!owner_discord_id || !webhook_url) {
    return res.status(400).json({ error: "owner_discord_id and webhook_url are required", received: body });
  }

  const id = "wh_" + crypto.randomBytes(9).toString("hex");
  const webhook_enc = encrypt(webhook_url);

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

  if (resp.ok) {
    res.status(200).json({ id });
  } else {
    const err = await resp.text();
    res.status(500).json({ error: "Supabase failed", details: err });
  }
};
