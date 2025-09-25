import express from "express";
import nacl from "tweetnacl";
import { handleGiveawayCommand, handleGiveawayComponent, startGiveawayTicker } from "./src-giveaways.js";
import { startCleanupScheduler } from "./src-cleanup.js";

const app = express();

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;      // for posting/pinning
const INFO_CHANNEL_ID = process.env.INFO_CHANNEL_ID;  // target #information channel id

// Keep raw body for signature verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

// Verify Discord signatures
function isValidDiscordRequest(req) {
  const signature = req.get("X-Signature-Ed25519");
  const timestamp = req.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !req.rawBody) return false;

  // IMPORTANT: concat bytes, not strings
  const timestampBytes = Buffer.from(timestamp, "utf8");
  const bodyBytes = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : Buffer.from(req.rawBody, "utf8");
  const message = Buffer.concat([timestampBytes, bodyBytes]);

  return nacl.sign.detached.verify(
    message,
    Buffer.from(signature, "hex"),
    Buffer.from(PUBLIC_KEY, "hex")
  );
}

// Build the public embeds + dropdown (for /post_info and /donate)
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
          {
            name: "Donation information",
            value: "Information about the perks and costs of donation to Code Red Creations",
            inline: false
          },
          {
            name: "Applying for a Staff or Developer position.",
            value: "Information about the requirements for applying and more.",
            inline: false
          },
          {
            name: "Products Information",
            value: "Information about the products we sell at Code Red Creations.",
            inline: false
          },
          {
            name: "Affiliation Information",
            value: "Information about perks and requirements to affiliate with Code Red Creations.",
            inline: false
          }
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

// Main interaction handler
app.post("/interactions", async (req, res) => {
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
    if (body.type === 1) return res.json({ type: 1 }); // PING

    const cmd = (body.data?.name || "").toLowerCase().replace(/[-\s]+/g, "_");

    // TEMP PROOF: reply fast for /gstart
    if (body.type === 2 && cmd === "gstart") {
      return res.json({ type: 4, data: { flags: 64, content: "Router OK – modal next." } });
    }

    // Giveaways (when temp is removed)
    if (body.type === 2) {
      const payload = await handleGiveawayCommand(body, BOT_TOKEN);
      if (payload) return res.json(payload);
    }
    if (body.type === 3 || body.type === 5) {
      const payload = await handleGiveawayComponent(body, BOT_TOKEN);
      if (payload) return res.json(payload);
    }

    // ... your /post_info, /donate, select menu handlers ...


    // 4) /post_info command
    if (body.type === 2 && cmd === "post_info") {
      if (!BOT_TOKEN || !INFO_CHANNEL_ID) {
        return res.json({
          type: 4,
          data: { flags: 64, content: "Missing BOT token or INFO_CHANNEL_ID env vars on the server." }
        });
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
      let posted;
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

      return res.json({
        type: 4,
        data: { flags: 64, content: `Posted${pinned ? " and pinned" : ""} in <#${INFO_CHANNEL_ID}>.` }
      });
    }

    // 5) /donate command
    if (body.type === 2 && body.data?.name === "donate") {
      const content = buildPublicContent();
      return res.json({ type: 4, data: { embeds: content.embeds, components: content.components } });
    }

    // 6) Dropdown select
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

    // Fallback
      return res.json({ type: 4, data: { flags: 64, content: "Unhandled." } });

  } catch (err) {
    // ===== and this catch belongs right after fallback =====
    console.error("INT HANDLER ERROR", err);
    try {
      return res.json({ type: 4, data: { flags: 64, content: "Sorry, something went wrong." } });
    } catch {}
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`CRC interactions on :${port}`));

// Background jobs
startCleanupScheduler();
startGiveawayTicker(BOT_TOKEN);
