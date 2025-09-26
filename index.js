// index.js — all-in-one (Express + Discord verify + Giveaways + DB + Cleanup)

import express from "express";
import nacl from "tweetnacl";
import pg from "pg";
const { Pool } = pg;

/* =========================
   Env & constants
   ========================= */
const PUBLIC_KEY     = process.env.DISCORD_PUBLIC_KEY;
const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN;
const INFO_CHANNEL_ID= process.env.INFO_CHANNEL_ID;
const DATABASE_URL   = process.env.DATABASE_URL;

// Giveaways config
const DEF_WINNERS    = Number(process.env.G_DEFAULT_WINNERS ?? 1);
const DEF_DURATION   = String(process.env.G_DEFAULT_DURATION ?? "1h");
const ENTER_ROLE     = process.env.G_GIVEAWAY_ROLE_ID || null; // optional role required to join

// Cleanup config
const RETENTION_DAYS = Math.max(1, parseInt(process.env.G_RETENTION_DAYS || "7", 10));
const ONE_DAY_MS     = 24 * 60 * 60 * 1000;
const JITTER_MS      = Math.floor(Math.random() * 5 * 60 * 1000); // 0–5 min random delay

/* =========================
   Postgres (pooled)
   ========================= */
if (!DATABASE_URL) {
  console.warn("[db] DATABASE_URL is missing! Set to your External connection string.");
}
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes(".render.com")
    ? { rejectUnauthorized: false }
    : undefined,
});

async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

/* =========================
   Helpers
   ========================= */
const app = express();

// keep raw body for signature verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

function isValidDiscordRequest(req) {
  const signature = req.get("X-Signature-Ed25519");
  const timestamp = req.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !req.rawBody) return false;

  // concat bytes (not strings)
  const message = Buffer.concat([
    Buffer.from(timestamp, "utf8"),
    Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody, "utf8")
  ]);

  return nacl.sign.detached.verify(
    message,
    Buffer.from(signature, "hex"),
    Buffer.from(PUBLIC_KEY, "hex")
  );
}

function parseDuration(str) {
  if (!str) return null;
  const re = /(\d+)\s*(d|h|m|s)/gi;
  const mult = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  let ms = 0, m;
  while ((m = re.exec(str))) ms += Number(m[1]) * mult[m[2].toLowerCase()];
  return ms > 0 ? ms : null;
}

const ts = (date) => `<t:${Math.floor(date.getTime() / 1000)}:R>`;

/* =========================
   Info embeds (public)
   ========================= */
function buildPublicContent() {
  return {
    embeds: [
      {
        color: 16711422,
        image: {
          url: "https://media.discordapp.net/attachments/1197237670095622264/1420109288050790504/INFORMATION.png?ex=68d4dc16&is=68d38a96&hm=119947f3c99253d01ba484dca05d7249432edfb2c1f7073308919ea7bb869e5a&=&format=webp&quality=lossless&width=324&height=162"
        }
      },
      {
        color: 16711422,
        description: "Select a category from the dropdown to learn more about each category.",
        fields: [
          { name: "Donation information", value: "Information about the perks and costs of donation to Code Red Creations", inline: false },
          { name: "Applying for a Staff or Developer position.", value: "Information about the requirements for applying and more.", inline: false },
          { name: "Products Information", value: "Information about the products we sell at Code Red Creations.", inline: false },
          { name: "Affiliation Information", value: "Information about perks and requirements to affiliate with Code Red Creations.", inline: false }
        ]
      }
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "crc_info_select",
            placeholder: "Choose a category…",
            options: [
              { label: "Donation information",          value: "donation_info",    emoji: { name: "💵" } },
              { label: "Applying for Staff/Developer", value: "applying_info",    emoji: { name: "🛡️" } },
              { label: "Products information",         value: "products_info",    emoji: { name: "🛒" } },
              { label: "Affiliation information",      value: "affiliation_info", emoji: { name: "🤝" } }
            ]
          }
        ]
      }
    ]
  };
}

/* =========================
   Giveaways (inline)
   ========================= */
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

// /gstart -> return modal payload
async function giveawaysSlash(body) {
  const name = (body.data?.name || "").toLowerCase().replace(/[-\s]+/g, "_");
  if (name !== "gstart") return null;

  return {
    type: 9,
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

// Modal submit + join button -> return payloads
async function giveawaysComponents(body) {
  // Modal submit -> create giveaway
  if (body.type === 5 && body.data?.custom_id === "gstart_modal") {
    try {
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
        return { type: 4, data: { flags: 64, content: "Invalid form: need Prize and valid Duration (e.g. `1h 30m`, `2d`)." } };
      }

      const endsAt = new Date(Date.now() + durMs);

      // Insert giveaway (message_id later)
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

      // Post public message with Join button
      const postRes = await fetch(`https://discord.com/api/v10/channels/${body.channel_id}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [ buildGiveawayEmbed(g) ],
          components: [{ type: 1, components: [{ type: 2, style: 1, label: "Join 🎉", custom_id: `g_join:${g.id}` }]}]
        })
      });

      const posted = await postRes.json().catch(() => null);
      if (!postRes.ok) {
        return { type: 4, data: { flags: 64, content: `Couldn't post giveaway (HTTP ${postRes.status}).` } };
      }

      // Save message id
      await query(`UPDATE giveaways SET message_id=$1 WHERE id=$2`, [posted.id, g.id]);

      return { type: 4, data: { flags: 64, content: `Giveaway created (ends ${ts(new Date(g.ends_at))}).` } };
    } catch (err) {
      console.error("[gstart_modal] error:", err);
      return { type: 4, data: { flags: 64, content: "Could not create the giveaway (error)." } };
    }
  }

  // Join button
  if (body.type === 3 && body.data?.custom_id?.startsWith("g_join:")) {
    try {
      const giveawayId = body.data.custom_id.split(":")[1];
      const userId     = String(body.member?.user?.id || body.user?.id);

      if (ENTER_ROLE) {
        const roles = body.member?.roles || [];
        if (!roles.includes(ENTER_ROLE)) {
          return { type: 4, data: { flags: 64, content: `You need <@&${ENTER_ROLE}> to join this giveaway.` } };
        }
      }

      await query(`INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES ($1,$2)`, [giveawayId, userId]);
      return { type: 4, data: { flags: 64, content: "✅ You joined!" } };
    } catch {
      // unique violation = already joined
      return { type: 4, data: { flags: 64, content: "You're already in." } };
    }
  }

  return null;
}

/* =========================
   Cleanup (inline)
   ========================= */
async function runCleanup() {
  try {
    // delete non-running giveaways older than RETENTION_DAYS
    const del = await query(
      `DELETE FROM giveaways
        WHERE status <> 'running'
          AND ends_at < NOW() - make_interval(days => $1::int)`,
      [RETENTION_DAYS]
    );
    if (del.rowCount) {
      console.log(`[cleanup] deleted ${del.rowCount} old giveaways (entries removed via CASCADE)`);
    }
  } catch (err) {
    console.error("[cleanup] error:", err);
  }
}
function startCleanupScheduler() {
  // once on boot + daily
  setTimeout(() => {
    runCleanup().catch(() => {});
    setInterval(() => runCleanup().catch(() => {}), ONE_DAY_MS);
  }, JITTER_MS);
}

/* =========================
   Interactions route
   ========================= */
app.post("/interactions", async (req, res) => {
  // signature
  try {
    if (!isValidDiscordRequest(req)) {
      console.error("SIGNATURE FAIL");
      return res.status(401).send("Bad signature");
    }
  } catch (e) {
    console.error("SIG CHECK ERROR", e);
    return res.status(401).send("Bad signature");
  }

  const body = req.body;
  console.log("INT", { type: body.type, name: body.data?.name, custom_id: body.data?.custom_id });

  try {
    // PING
    if (body.type === 1) return res.json({ type: 1 });

    const cmd = (body.data?.name || "").toLowerCase().replace(/[-\s]+/g, "_");

    // Giveaways (slash)
    if (body.type === 2) {
      const payload = await giveawaysSlash(body);
      if (payload) return res.json(payload);
    }

    // Giveaways (components)
    if (body.type === 3 || body.type === 5) {
      const payload = await giveawaysComponents(body);
      if (payload) return res.json(payload);
    }

    // /post_info (post & pin)
    if (body.type === 2 && cmd === "post_info") {
      if (!BOT_TOKEN || !INFO_CHANNEL_ID) {
        return res.json({ type: 4, data: { flags: 64, content: "Missing BOT token or INFO_CHANNEL_ID." } });
      }
      const perms = body.member?.permissions ?? "0";
      const isAdmin = (BigInt(perms) & (1n << 3n)) !== 0n; // ADMINISTRATOR
      if (!isAdmin) {
        return res.json({ type: 4, data: { flags: 64, content: "Only admins can run this." } });
      }
      const content = buildPublicContent();
      const postRes = await fetch(`https://discord.com/api/v10/channels/${INFO_CHANNEL_ID}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: content.embeds, components: content.components })
      });
      let pinned = false;
      let posted = null;
      try { posted = await postRes.json(); } catch {}
      try {
        if (posted?.id) {
          const pinRes = await fetch(`https://discord.com/api/v10/channels/${INFO_CHANNEL_ID}/pins/${posted.id}`, {
            method: "PUT",
            headers: { "Authorization": `Bot ${BOT_TOKEN}` }
          });
          pinned = pinRes.ok;
        }
      } catch {}
      return res.json({ type: 4, data: { flags: 64, content: `Posted${pinned ? " and pinned" : ""} in <#${INFO_CHANNEL_ID}>.` } });
    }

    // /donate preview
    if (body.type === 2 && body.data?.name === "donate") {
      const content = buildPublicContent();
      return res.json({ type: 4, data: { embeds: content.embeds, components: content.components } });
    }

    // Dropdown -> ephemeral embeds
    if (body.type === 3 && body.data?.custom_id === "crc_info_select") {
      const key = body.data.values?.[0];
      const embedByKey = {
        donation_info: {
          color: 16711422,
          title: "Donation information",
          description:
            "If you would like to support our community and get some perks for yourself, you can do it over here:\n" +
            "[Code Red Creations - Roblox Group](https://www.roblox.com/share/g/70326561)\n" +
            "*Create a ticket to aquire your role.*",
          fields: [
            { name: "💎 - Platinum Member", value: "- Shout out\n- Role + Colour\n- Exclusive Sneak Peeks\n- Platinum Chat\n- Platinum Call\n*Price: 200R$/month*", inline: true },
            { name: "💎 - Platinum Member (Lifetime)", value: "- Shout out\n- Role + Colour\n- Exclusive Sneak Peeks\n- Platinum Chat\n- Platinum Call\n*Price: 2200R$*", inline: true },
            { name: "⚜️ - Ultimate Member", value: "- Shout out\n- Role + Colour\n- Exclusive Sneak Peeks\n- Platinum **and** Ultimate Chat\n- Platinum **and** Ultimate Call\n- Ultimate Giveaways\n*Price: 400R$/month*", inline: true },
            { name: "🌟 - Server Booster", value: "- Shout out\n- Role + Colour\n- Exclusive Sneak Peeks\n- Platinum Chat\n- Platinum Call", inline: true }
          ]
        },
        applying_info: {
          color: 16711422,
          title: "Applying for a Staff or Developer position",
          description: "At Code Red Creations, we’re looking for active UGC developers and, from time to time, new staff members to strengthen our team.",
          fields: [
            { name: "Applying for the Staff Team", value: "Help enforce rules and support members.\n\nKeep an eye on announcements for openings!", inline: false },
            { name: "Applying for UGC Developer", value: "We’re always looking for active and experienced UGC creators.\n\nOpen a ticket and share your portfolio!", inline: false }
          ]
        },
        products_info: {
          color: 16711422,
          title: "Products information",
          description: "We create high-quality Roblox UGCs.\n\nFind all our products in <#1417530200283152465>. Open a ticket for questions."
        },
        affiliation_info: {
          color: 16711422,
          title: "Affiliation information",
          description: "Our Affiliation Program lets communities collaborate with Code Red Creations.\n\nOpen a ticket if interested.",
          fields: [
            { name: "Perks", value: "- UGCs inspired by your community\n- Priority suggestions\n- Exclusive sneak peeks\n- Updates in your Sneak Peeks channel\n- Promotion in our server", inline: true },
            { name: "Requirements", value: "- Active, community-focused server\n- Promote CRC visibly\n- Allow progress updates in Sneak Peeks\n- Friendly environment\n- Open to collaboration", inline: true }
          ]
        }
      };
      const picked = embedByKey[key] ?? { color: 16711422, title: "Unknown", description: "This option is not configured." };
      return res.json({ type: 4, data: { flags: 64, embeds: [picked] } });
    }

    // fallback
    return res.json({ type: 4, data: { flags: 64, content: "Unhandled." } });
  } catch (err) {
    console.error("INT HANDLER ERROR", err);
    try {
      return res.json({ type: 4, data: { flags: 64, content: "Sorry, something went wrong." } });
    } catch {}
  }
});

/* =========================
   Boot
   ========================= */
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`CRC interactions on :${port}`));

// background cleanup
startCleanupScheduler();
