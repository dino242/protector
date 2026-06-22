// api/send-message.js — Nebula Hub vault proxy (JSON body with webhook_id)
const crypto = require("crypto");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

function getKey() {
  if (!ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not configured");
  }
  return crypto.createHash("sha256").update(String(ENCRYPTION_KEY)).digest();
}

function decrypt(b64) {
  const key = getKey();
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function parseBody(req) {
  if (req.body == null) {
    return {};
  }
  if (typeof req.body === "object") {
    return req.body;
  }
  if (typeof req.body === "string") {
    return JSON.parse(req.body || "{}");
  }
  return {};
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_KEY || !ENCRYPTION_KEY) {
    console.error("[send-message] missing env configuration");
    res.status(500).json({ error: "Server misconfigured" });
    return;
  }

  let body;
  try {
    body = parseBody(req);
  } catch (error) {
    console.error("[send-message] invalid JSON:", error.message);
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const webhook_id =
    body.webhook_id != null ? String(body.webhook_id).trim() : "";

  if (!webhook_id) {
    res.status(400).json({ error: "webhook_id is required" });
    return;
  }

  const discordPayload = { ...body };
  delete discordPayload.webhook_id;

  const embeds = Array.isArray(discordPayload.embeds) ? discordPayload.embeds : [];
  const hasContent =
    typeof discordPayload.content === "string" && discordPayload.content.length > 0;

  if (!embeds.length && !hasContent) {
    res.status(400).json({ error: "embeds or content is required" });
    return;
  }

  try {
    const lookupUrl = `${SUPABASE_URL}/rest/v1/webhooks?id=eq.${encodeURIComponent(webhook_id)}&select=webhook_enc`;
    const lookup = await fetch(lookupUrl, {
      method: "GET",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    const rows = await lookup.json().catch(() => []);
    if (!lookup.ok || !Array.isArray(rows) || rows.length === 0) {
      console.error("[send-message] unknown webhook_id:", webhook_id);
      res.status(404).json({ error: "Unknown webhook id" });
      return;
    }

    const webhookUrl = decrypt(rows[0].webhook_enc);
    const discordResp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload),
    });

    const text = await discordResp.text();
    const contentType = discordResp.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      res.setHeader("Content-Type", "application/json");
    }

    res.status(discordResp.status).send(text || JSON.stringify({ ok: true }));
  } catch (error) {
    console.error("[send-message] error:", error);
    res.status(500).json({ error: "Internal error" });
  }
};
