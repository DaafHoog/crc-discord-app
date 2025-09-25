// src-giveaways.js
// Giveaway logic (slash command, modal, join button)
// Requires: src-database.js (exports { query }), and DATABASE_URL env on Render.

import { query } from "./src-database.js";

// ── Config via env ─────────────────────────────────────────────────────────────
const DEF_WINNERS  = Number(process.env.G_DEFAULT_WINNERS ?? 1);
const DEF_DURATION = String(process.env.G_DEFAULT_DURATION ?? "1h");
const ENTER_ROLE   = process.env.G_GIVEAWAY_ROLE_ID || null; // optional role id needed to join
const TICK_MS      = Number(process.env.G_TICK_MS ?? 0);     // reserved for future auto-end

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseDuration(str) {
  if (!str) return null;
  const re = /(\d+)\s*(d|h|m|s)/gi;
  const mult = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  let ms = 0, m;
  while ((m = re.exec(str))) ms += Number(m[1]) * mult[m[2].toLowerCase()];
  return ms > 0 ? ms : null;
}

const ts = (date) => `<t:${Math.floor(date.getTime() / 1000)}:R>`; // Discord relative time

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

// ── Public API (called from index.js) ──────────────────────────────────────────

/**
 * Slash commands (type=2). Return a JSON payload or null.
 * Opens the Create Giveaway modal for /gstart.
 */
export async function handleGiveawayCommand(body /*, botToken */) {
  const name = (body.data?.name || "").toLowerCase().replace(/[-\s]+/g, "_");
  if (name !== "gstart") return null;

  return {
    type: 9, // MODAL
    data: {
      custom_id: "gstart_modal",
      title: "Create Giveaway",
      components: [
        { type: 1, components: [{ type: 4, custom_id: "prize",       label: "Prize",                  style: 1, required: true,  max_length: 100 }] },
        { type: 1, components: [{ type: 4, custom_id: "title",       label: "Title (optional)",       style: 1, required: false, max_length: 100 }] },
        { type: 1, components: [{ type: 4, custom_id: "description", label: "Description (optional)",  style: 2, required: false, max_length: 1000 }] },
        { type: 1, components: [{ type: 4, custom_id: "duration",    label: `Duration (e.g. ${DEF_DURATION})`, style: 1, required: true }] },
        { type: 1, components: [{ type: 4, custom_id: "winners",     label: `Winners (default ${DEF_WINNERS})`, style: 1, required: false }] },
        { type: 1, components: [{ type: 4, custom_id: "host_id",     label: "Host ID (optional)",      style: 1, required: false }] },
      ],
    },
  };
}

/**
 * Components (type=5 for modal submit, type=3 for button click).
 * Return a JSON payload (Discord interaction response) or null.
 */
export async function handleGiveawayComponent(body, botToken) {
  // ── Modal submit: create giveaway ──
  if (body.type === 5 && body.data?.custom_id === "gstart_modal") {
    try {
      // Gather modal inputs
      const kv = Object.fromEntries(
        (body.data.components || [])
          .flatMap(r => r.components || [])
          .map(c => [c.custom_id, (c.value ?? "").trim()])
      );

      const prize       = kv.prize;
      const title       = kv.title || null;
      const description = kv.description || null;
      const winners     = Math.max(1, Number(kv.winners || DEF_WINNERS));
      const host_id     = kv.host_id || null;
      const durMs       = parseDuration(kv.duration || DEF_DURATION);

      if (!prize || !durMs) {
        return { type: 4, data: { flags: 64, content: "Invalid form: please provide Prize and a valid Duration (e.g. `1h 30m`, `2d`, `45m`)." } };
      }

      const endsAt = new Date(Date.now() + durMs);

      // Insert giveaway (message_id unknown until we post)
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

      // Post the public giveaway message (Node 18+ has global fetch)
      const postRes = await fetch(`https://discord.com/api/v10/channels/${body.channel_id}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bot ${botToken}`,
          "Content-Type": "application/json"
        },
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
        return { type: 4, data: { flags: 64, content: `Couldn't post giveaway (HTTP ${postRes.status}).` } };
      }

      // Save message_id on our giveaway row
      await query(`UPDATE giveaways SET message_id=$1 WHERE id=$2`, [posted.id, g.id]);

      return {
        type: 4,
        data: { flags: 64, content: `Giveaway created (ends ${ts(new Date(g.ends_at))}).` }
      };
    } catch (err) {
      console.error("[gstart_modal] error:", err);
      return { type: 4, data: { flags: 64, content: "Could not create the giveaway (error)." } };
    }
  }

  // ── Join button: add entry ──
  if (body.type === 3 && body.data?.custom_id?.startsWith("g_join:")) {
    try {
      const giveawayId = body.data.custom_id.split(":")[1];
      const userId     = String(body.member?.user?.id || body.user?.id);

      // Optional role requirement
      if (ENTER_ROLE) {
        const roles = body.member?.roles || [];
        if (!roles.includes(ENTER_ROLE)) {
          return { type: 4, data: { flags: 64, content: `You need <@&${ENTER_ROLE}> to join this giveaway.` } };
        }
      }

      await query(
        `INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES ($1,$2)`,
        [giveawayId, userId]
      );

      return { type: 4, data: { flags: 64, content: "✅ You joined!" } };
    } catch (err) {
      // Likely unique violation (already joined)
      return { type: 4, data: { flags: 64, content: "You're already in." } };
    }
  }

  return null; // not for us
}

// Stub for later (auto-ending giveaways)
export function startGiveawayTicker(/* botToken */) {
  if (!TICK_MS || Number.isNaN(TICK_MS) || TICK_MS <= 0) return;
  // We’ll implement drawing winners & updating the message in a later step.
}
