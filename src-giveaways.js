// src-giveaways.js
import { query } from "./src-database.js";

const TICK_MS = Number(process.env.G_TICK_MS ?? 15000);
const DEF_WINNERS = Number(process.env.G_DEFAULT_WINNERS ?? 1);
const DEF_DURATION = String(process.env.G_DEFAULT_DURATION ?? "1h");
const ENTER_ROLE = process.env.G_GIVEAWAY_ROLE_ID || null;
const ANNOUNCE_PING = (process.env.G_ANNOUNCE_PING || "off").toLowerCase() === "on";

function parseDuration(str) {
  const re = /(\d+)\s*(d|h|m|s)/gi;
  const map = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  let ms = 0, m;
  while ((m = re.exec(str))) ms += Number(m[1]) * map[m[2].toLowerCase()];
  return ms || null;
}
const ts = (date) => `<t:${Math.floor(date.getTime()/1000)}:R>`;

function buildGiveawayEmbed(g) {
  return {
    title: `🎉 Giveaway: ${g.prize}`,
    description:
      (g.title ? `**${g.title}**\n` : "") +
      (g.description ? `${g.description}\n\n` : "") +
      `Ends ${ts(new Date(g.ends_at))}\n` +
      `Winners: **${g.winners}**` +
      (ENTER_ROLE ? `\nRequirement: <@&${ENTER_ROLE}>` : "") +
      (g.host_id ? `\nHost: <@${g.host_id}>` : ""),
  };
}

export async function handleGiveawayCommand(body, res, botToken) {
  const name = (body.data?.name || "").toLowerCase().replace(/[-\s]+/g, "_");
  if (name !== "gstart") return false;

  return res.json({
    type: 9,
    data: {
      custom_id: "gstart_modal",
      title: "Create Giveaway",
      components: [
        { type: 1, components: [{ type: 4, custom_id: "prize", label: "Prize", style: 1, required: true, max_length: 100 }] },
        { type: 1, components: [{ type: 4, custom_id: "title", label: "Title (optional)", style: 1, required: false, max_length: 100 }] },
        { type: 1, components: [{ type: 4, custom_id: "description", label: "Description (optional)", style: 2, required: false, max_length: 1000 }] },
        { type: 1, components: [{ type: 4, custom_id: "duration", label: `Duration (e.g. ${DEF_DURATION})`, style: 1, required: true }] },
        { type: 1, components: [{ type: 4, custom_id: "winners", label: `Winners (default ${DEF_WINNERS})`, style: 1, required: false }] },
        { type: 1, components: [{ type: 4, custom_id: "host_id", label: "Host ID (optional)", style: 1, required: false }] },
      ],
    },
  });
}

export async function handleGiveawayComponent(body, res, botToken) {
  if (body.type === 5 && body.data?.custom_id === "gstart_modal") {
    const kv = Object.fromEntries(
      body.data.components.flatMap(r => r.components).map(c => [c.custom_id, (c.value ?? "").trim()])
    );
    const prize = kv.prize;
    const title = kv.title || null;
    const description = kv.description || null;
    const winners = Math.max(1, Number(kv.winners || DEF_WINNERS));
    const host_id = kv.host_id || null;
    const durMs = parseDuration(kv.duration || DEF_DURATION);
    if (!durMs) {
      return res.json({ type: 4, data: { flags: 64, content: "Invalid duration. Use e.g. `1h 30m`, `2d`, `45m`, `15s`." } });
    }
    const ends = new Date(Date.now() + durMs);

    const ins = await query(
      `INSERT INTO giveaways (guild_id, channel_id, prize, title, description, winners, host_id, created_by, ends_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'running') RETURNING id, ends_at`,
      [String(body.guild_id), String(body.channel_id), prize, title, description, winners, host_id, String(body.member?.user?.id), ends.toISOString()]
    );
    const g = { id: ins.rows[0].id, prize, title, description, winners, host_id, ends_at: ins.rows[0].ends_at };

    const postRes = await fetch(`https://discord.com/api/v10/channels/${body.channel_id}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [ buildGiveawayEmbed(g) ],
        components: [{ type: 1, components: [{ type: 2, style: 1, label: "Join 🎉", custom_id: `g_join:${g.id}` }] }],
      }),
    });
    const posted = await postRes.json().catch(() => null);
    if (!postRes.ok) {
      return res.json({ type: 4, data: { flags: 64, content: `Couldn't post giveaway (${postRes.status}).` } });
    }
    await query(`UPDATE giveaways SET message_id=$1 WHERE id=$2`, [posted.id, g.id]);

    return res.json({ type: 4, data: { flags: 64, content: `Giveaway created (ends ${ts(new Date(g.ends_at))}).` } });
  }

  if (body.type === 3 && body.data?.custom_id?.startsWith("g_join:")) {
    const giveawayId = body.data.custom_id.split(":")[1];
    const userId = String(body.member?.user?.id || body.user?.id);

    if (ENTER_ROLE) {
      const roles = body.member?.roles || [];
      if (!roles.includes(ENTER_ROLE)) {
        return res.json({ type: 4, data: { flags: 64, content: `You need <@&${ENTER_ROLE}> to join.` } });
      }
    }

    try {
      await query(`INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES ($1,$2)`, [giveawayId, userId]);
      return res.json({ type: 4, data: { flags: 64, content: "✅ You joined!" } });
    } catch {
      return res.json({ type: 4, data: { flags: 64, content: "You're already in." } });
    }
  }

  return false;
}

export function startGiveawayTicker(_botToken) {
  if (Number.isNaN(TICK_MS) || TICK_MS <= 0) return;
  // ticker logic will be added later
}
