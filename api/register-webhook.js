// api/register-webhook.js — Nebula Hub Webhook Vault
const crypto = require("crypto");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

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

function getKey() {
  if (!ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not configured on Vercel");
  }
  return crypto.createHash("sha256").update(String(ENCRYPTION_KEY)).digest();
}

function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function isDiscordWebhook(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const hostOk =
      host === "discord.com" ||
      host === "discordapp.com" ||
      host.endsWith(".discord.com") ||
      host.endsWith(".discordapp.com");
    const pathOk = u.pathname.includes("/api/webhooks/");
    return hostOk && pathOk;
  } catch {
    return false;
  }
}

function supabaseHost() {
  try {
    return new URL(SUPABASE_URL).host;
  } catch {
    return "(invalid SUPABASE_URL)";
  }
}

module.exports = async (req, res) => {
  console.log("[register-webhook] ── incoming request ──");
  console.log("[register-webhook] method:", req.method);
  console.log("[register-webhook] content-type:", req.headers["content-type"]);

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  console.log("[register-webhook] env check:", {
    supabase_host: supabaseHost(),
    has_supabase_key: Boolean(SUPABASE_KEY),
    has_encryption_key: Boolean(ENCRYPTION_KEY),
  });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[register-webhook] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    res.status(500).json({ error: "Server misconfigured: missing Supabase credentials" });
    return;
  }

  if (!ENCRYPTION_KEY) {
    console.error("[register-webhook] Missing ENCRYPTION_KEY on Vercel");
    res.status(500).json({ error: "Server misconfigured: missing ENCRYPTION_KEY" });
    return;
  }

  let body;
  try {
    body = parseBody(req);
  } catch (error) {
    console.error("[register-webhook] JSON parse error:", error.message);
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  console.log("[register-webhook] parsed body keys:", Object.keys(body));

  const owner_discord_id =
    body.owner_discord_id != null ? String(body.owner_discord_id).trim() : "";
  const webhook_url = body.webhook_url != null ? String(body.webhook_url).trim() : "";

  console.log("[register-webhook] payload:", {
    owner_discord_id,
    webhook_url_length: webhook_url.length,
    webhook_host: webhook_url ? new URL(webhook_url).hostname : null,
  });

  if (!owner_discord_id || !webhook_url) {
    res.status(400).json({ error: "owner_discord_id and webhook_url are required" });
    return;
  }

  if (!isDiscordWebhook(webhook_url)) {
    res.status(400).json({ error: "Not a valid Discord webhook URL" });
    return;
  }

  const id = `wh_${crypto.randomBytes(9).toString("hex")}`;
  let webhook_enc;

  try {
    webhook_enc = encrypt(webhook_url);
    console.log("[register-webhook] encrypted webhook, ciphertext length:", webhook_enc.length);
  } catch (error) {
    console.error("[register-webhook] encryption error:", error.message);
    res.status(500).json({ error: "Encryption failed", detail: error.message });
    return;
  }

  const insertUrl = `${SUPABASE_URL}/rest/v1/webhooks`;
  const insertPayload = {
    id,
    owner_discord_id,
    webhook_enc,
  };

  console.log("[register-webhook] supabase POST:", insertUrl);
  console.log("[register-webhook] insert row id:", id);

  try {
    const resp = await fetch(insertUrl, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(insertPayload),
    });

    const rawText = await resp.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { raw: rawText };
    }

    console.log("[register-webhook] supabase response:", {
      status: resp.status,
      ok: resp.ok,
      body: data,
    });

    if (!resp.ok) {
      res.status(500).json({
        error: "Supabase insert failed",
        status: resp.status,
        detail: data,
      });
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const returnedId = row?.id || id;
    console.log("[register-webhook] success, vault id:", returnedId);
    res.status(200).json({ id: returnedId });
  } catch (error) {
    console.error("[register-webhook] fetch/insert exception:", error);
    res.status(500).json({
      error: "Internal error",
      detail: error.message,
    });
  }
};
