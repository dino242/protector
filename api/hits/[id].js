// api/hit/[id].js
const crypto = require("crypto");

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ENCRYPTION_KEY,
  HIT_STATS_URL,
  HIT_STATS_KEY,
} = process.env;

function getKey() {
  const base = ENCRYPTION_KEY || "CHANGE_THIS_TO_A_LONG_SECRET";
  return crypto.createHash("sha256").update(String(base)).digest();
}

function decrypt(b64) {
  const key = getKey();
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

// ========= Rate limit cũ (tổng request) =========
const ipHits = new Map(); // ip -> [timestamps]
const idHits = new Map(); // id -> [timestamps]

// ========= Rate limit mới chỉ cho EMBED =========
const embedIpHits = new Map(); // ip -> [timestamps embed]

function clean(arr, now, windowSec) {
  return arr.filter((t) => now - t < windowSec);
}

function checkIp(ip) {
  const now = Date.now() / 1000;
  const arr = clean(ipHits.get(ip) || [], now, 3600);
  arr.push(now);
  ipHits.set(ip, arr);

  const last1s = arr.filter((t) => now - t < 1).length;
  const last60s = arr.filter((t) => now - t < 60).length;
  const last3600 = arr.length;

  if (last1s > 5 || last60s > 40 || last3600 > 500) return false;
  return true;
}

function checkId(id) {
  const now = Date.now() / 1000;
  const arr = clean(idHits.get(id) || [], now, 3600);
  arr.push(now);
  idHits.set(id, arr);

  const last60s = arr.filter((t) => now - t < 60).length;
  const last3600 = arr.length;

  if (last60s > 120 || last3600 > 2000) return false;
  return true;
}

// ---- ONLY EMBED + limit 3/phút, 20/ngày ----
function checkEmbedIp(ip) {
  const now = Date.now() / 1000;

  let arr = embedIpHits.get(ip) || [];
  // giữ log 1 ngày
  arr = clean(arr, now, 86400);
  arr.push(now);
  embedIpHits.set(ip, arr);

  const last60s = arr.filter((t) => now - t < 60).length;
  const lastDay = arr.length;

  // >3 embed / phút hoặc >20 embed / ngày ⇒ chặn
  if (last60s > 3 || lastDay > 20) return false;
  return true;
}

// ============ Gửi hit sang AZDIGI stats server ============
async function sendHitToStats(ownerDiscordId, mozilMeta) {
  try {
    if (!HIT_STATS_URL || !HIT_STATS_KEY) return;

    const payload = {
      ownerDiscordId: String(ownerDiscordId),
      script: mozilMeta.script || null,
      game: mozilMeta.game || null,
      placeId: mozilMeta.placeId ?? null,
      jobId: mozilMeta.jobId ?? null,
      playerUserId: mozilMeta.userId ?? null,
      playerUsername: mozilMeta.username ?? null,
    };

    await fetch(HIT_STATS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mozil-stats-key": HIT_STATS_KEY,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("[hit] sendHitToStats error:", e);
  }
}

// ============================================

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { id, ...queryRest } = req.query || {};
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }

  // Parse body an toàn
  let body = {};
  try {
    body =
      typeof req.body === "object" && req.body !== null
        ? req.body
        : JSON.parse(req.body || "{}");
  } catch {
    body = {};
  }

  // tách mozil_meta ra, không gửi lên Discord
  const mozilMeta =
    body && typeof body.mozil_meta === "object" && body.mozil_meta !== null
      ? body.mozil_meta
      : null;

  const bodyForDiscord = { ...(body || {}) };
  if ("mozil_meta" in bodyForDiscord) {
    delete bodyForDiscord.mozil_meta;
  }

  const ip =
    (req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  // rate limit tổng
  if (!checkIp(ip)) {
    res.status(429).json({ error: "IP rate limit exceeded" });
    return;
  }
  if (!checkId(id)) {
    res.status(429).json({ error: "Webhook rate limit exceeded" });
    return;
  }

  // ===== ONLY EMBED + rate limit embed theo IP =====
  const embeds = Array.isArray(bodyForDiscord.embeds)
    ? bodyForDiscord.embeds
    : [];

  if (!embeds || embeds.length === 0) {
    // Không có embed ⇒ không cho dùng vault
    res
      .status(400)
      .json({ error: "This vault only accepts payloads with embeds" });
    return;
  }

  if (!checkEmbedIp(ip)) {
    res
      .status(429)
      .json({ error: "Embed rate limit exceeded for this IP" });
    return;
  }

  const rawBody = JSON.stringify(bodyForDiscord || {});

  try {
    // Lấy webhook_enc + owner_discord_id từ Supabase
    const url = `${SUPABASE_URL}/rest/v1/webhooks?id=eq.${encodeURIComponent(
      id
    )}&select=webhook_enc,owner_discord_id`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    const rows = await resp.json().catch(() => []);

    if (!resp.ok || !Array.isArray(rows) || rows.length === 0) {
      res.status(404).json({ error: "Unknown webhook id" });
      return;
    }

    const row = rows[0];
    const webhookUrl = decrypt(row.webhook_enc);
    const ownerDiscordId = row.owner_discord_id || null;

    // nếu có mozil_meta + ownerDiscordId thì báo hit sang AZDIGI
    if (mozilMeta && ownerDiscordId) {
      // fire-and-forget, không chặn flow
      sendHitToStats(ownerDiscordId, mozilMeta);
    }

    // ---- GHÉP query (?wait=true, ...) sang Discord webhook ----
    let targetUrl = webhookUrl;
    const qs = new URLSearchParams(queryRest || {});
    const qsStr = qs.toString();
    if (qsStr) {
      targetUrl += (webhookUrl.includes("?") ? "&" : "?") + qsStr;
    }

    // Forward tới Discord
    const discordResp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    });

    const text = await discordResp.text();
    const ct = discordResp.headers.get("content-type") || "";

    if (ct.includes("application/json")) {
      res.setHeader("Content-Type", "application/json");
    }

    res.status(discordResp.status).send(text);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal error" });
  }
};
