// src-giveaways.js
// Giveaway logic (slash command, modal, join button)
// Requires: src-database.js in repo root (exports { query })

import { query } from "./src-database.js";

// ---- config from env ----
const TICK_MS       = Number(process.env.G_TICK_MS ?? 15000);    // heartbeat (unused for now)
const DEF_WINNERS   = Number(process.env.G_DEFAULT_WINNERS ?? 1);
const DEF_DURATION  = String(process.env.G_DEFAULT_DURATION ?? "1h");
const ENTER_ROLE    = process.env.G_GIVEAWAY_ROLE_ID || null;     // optional role required to join
const ANNOUNCE_PING = (process.env.G_ANNOUNCE_PING || "off").toLowerCase() === "on"; // reserved for later

// ---------- helper functions ----------
function parseDuration(str) {
  // supports: "2d 3h 15m", "1h", "45m", "20s"
  if (!str) return null;
  const re = /(\d+)\s*(d|h|m|s)/gi;
  const mult = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  let ms = 0; let m;
  while ((m = re.exec(str))) ms += Number(m[1]) * mult[m[2].toLowerCase()];
  return ms > 0 ? ms : null;
}

const ts = (date) => `<t:${Math.floor(date.getTime() / 1000)}:R>`; // Discord relative timestamp

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

// ===========================================================
// ========== EXPORTED API (used by your index.js) ===========
// ===========================================================

/**
 * Handle slash commands (type = 2)
 * Returns true if handled.
 */
export async function handleGiveawayCommand(body, res, _botToken) {
  const name = (body.data?.name || "").toLowerCase().replace(/[-\s]+/g, "_");
  if (name !== "gstart") return false;

  // Open the modal
  await res.json({
    type: 9, // MODAL
    data: {
      custom_id: "gstart_modal",
      title: "Create Giveaway",
      components: [
        { type: 1, components: [{ type: 4, custom_id: "prize",       label: "Prize",                 style: 1, required: true,  max_length: 100 }] },
        { type: 1, components: [{ type: 4, custom_id: "title",       label: "Title (optional)",      style: 1, required: false, max_length: 100 }] },
        { type: 1, components: [{ type: 4, custom_id: "description", label: "Description (optional)", style: 2, required: false, max_length: 1000 }] },
        { type: 1, components: [{ type: 4, custom_id: "duration",    label: `Duration (e.g. ${DEF_DURATION})`, style: 1, required: true }] },
        { type: 1, components: [{ type: 4, custom_id: "winners",     label: `Winners (default ${DEF_WINNERS})`, style: 1, required: false }] },
        { type: 1, components: [{ type: 4, custom_id: "host_id",     label: "Host ID (optional)",     style: 1, required: false }] },
      ],
    },
  });
  return true;
}

/**
 * Handle components:
 * - type = 5 (modal submit)
 * - type = 3 (button press)
 * Returns true if handled.
 */
export async function handleGiveawayComponent(body, res, botToken) {
  // ----- Modal submit (create giveaway) -----
  if (body.type === 5 && body.data?.custom_id === "gstart_modal") {
    const kv = Object.fromEntries(
      (body.data.components || [])
        .flatMap((row) => row.components || [])
        .map((c) => [c.custom_id, (c.value ?? "").trim()])
    );

    const prize       = kv.prize;
    const title       = kv.title || null;
    const description = kv.description || null;
    const winners     = Math.max(1, Number(kv.winners || DEF_WINNERS));
    const host_id     = kv.host_id || null;
    const durMs       = parseDuration(kv.duration || DEF_DURATION);

    if (!prize || !durMs) {
      await res.json({
        type: 4,
        data: { flags: 64, content: "Invalid form: please provide Prize and a valid Duration (e.g. `1h 30m`, `2d`, `45m`)." }
      });
      return true;
    }

    const endsAt = new Date(Date.now() + durMs);

    // Insert giveaway row
    const ins = await query(
      `INSERT INTO giveaways
         (guild_id, channel_id, prize, title, description, winners, host_id, created_by, ends_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'running')
       RETURNING id, ends_at`,
      [
        String(body.guild_id),
        String(body.channel_id),
        prize, title, description,
        winners, host_id,
        String(body.member?.user?.id || body.user?.id),
        endsAt.toISOString()
      ]
    );

    const g = {
      id: ins.rows[0].id,
      prize, title, description, winners, host_id,
      ends_at: ins.rows[0].ends_at
    };

    // Post the public giveaway message
    const postRes = await fetch(`https://discord.com/api/v10/channels/${body.channel_id}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [ buildGiveawayEmbed(g) ],
        components: [
          { type: 1, components: [
            { type: 2, style: 1, label: "Join 🎉", custom_id: `g_join:${g.id}` }
          ]}
        ]
      })
    });

    const posted = await postRes.json().catch(() => null);
    if (!postRes.ok) {
      await res.json({ type: 4, data: { flags: 64, content: `Couldn't post giveaway (${postRes.status}).` } });
      return true;
    }

    // Save message_id
    await query(`UPDATE giveaways SET message_id=$1 WHERE id=$2`, [posted.id, g.id]);

    await res.json({
      type: 4,
      data: { flags: 64, content: `Giveaway created (ends ${ts(new Date(g.ends_at))}).` }
    });
    return true;
  }

  // ----- Button: Join -----
  if (body.type === 3 && body.data?.custom_id?.startsWith("g_join:")) {
    const giveawayId = body.data.custom_id.split(":")[1];
    const userId     = String(body.member?.user?.id || body.user?.id);

    // role requirement check
    if (ENTER_ROLE) {
      const roles = body.member?.roles || [];
      if (!roles.includes(ENTER_ROLE)) {
        await res.json({ type: 4, data: { flags: 64, content: `You need <@&${ENTER_ROLE}> to join.` } });
        return true;
      }
    }

    try {
      await query(`INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES ($1,$2)`, [giveawayId, userId]);
      await res.json({ type: 4, data: { flags: 64, content: "✅ You joined!" } });
    } catch {
      await res.json({ type: 4, data: { flags: 64, content: "You're already in." } });
    }
    return true;
  }

  return false; // not handled
}

// Stub ticker (will handle auto-end later)
export function startGiveawayTicker(_botToken) {
  if (Number.isNaN(TICK_MS) || TICK_MS <= 0) return;
}
