// api/leaderboard.js

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

/**
 * GET /api/leaderboard?range=daily|weekly|monthly
 *
 * Returns top 10 users with the most hits in the selected period.
 */
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const range = (req.query.range || "weekly").toLowerCase();

  let days;
  if (range === "daily") days = 1;
  else if (range === "monthly") days = 30;
  else days = 7; // default weekly

  const now = Date.now();
  const since = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Aggregate with PostgREST: group by owner_discord_id and count hits
    const url =
      `${SUPABASE_URL}/rest/v1/hits` +
      `?select=owner_discord_id,count:count()` +
      `&created_at=gte.${encodeURIComponent(since)}` +
      `&order=count.desc` +
      `&limit=10`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    const data = await resp.json().catch(() => []);

    if (!resp.ok) {
      console.error("[leaderboard] Supabase error", resp.status, data);
      res.status(500).json({ error: "Supabase error", status: resp.status });
      return;
    }

    const items = (data || []).map((row) => ({
      owner_discord_id: row.owner_discord_id,
      count: Number(row.count) || 0,
    }));

    res.status(200).json({ range, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal error" });
  }
};
