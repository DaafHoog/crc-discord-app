import express from "express";
import nacl from "tweetnacl";

const app = express();
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;      // NEW: for posting/pinning
const INFO_CHANNEL_ID = process.env.INFO_CHANNEL_ID;  // NEW: target #information channel id

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

function isValidDiscordRequest(req) {
  const signature = req.get("X-Signature-Ed25519");
  const timestamp = req.get("X-Signature-Timestamp");
  if (!signature || !timestamp) return false;
  return nacl.sign.detached.verify(
    Buffer.from(timestamp + req.rawBody),
    Buffer.from(signature, "hex"),
    Buffer.from(PUBLIC_KEY, "hex")
  );
}

// ----- helper: the public embeds + dropdown you already use -----
function buildPublicContent() {
  return {
    embeds: [
      {
        color: 16711422, // #FEFEFE
        image: {
          url: "https://media.discordapp.net/attachments/1197237670095622264/1420109288050790504/INFORMATION.png?ex=68d4dc16&is=68d38a96&hm=119947f3c99253d01ba484dca05d7249432edfb2c1f7073308919ea7bb869e5a&=&format=webp&quality=lossless&width=324&height=162"
      }
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
        type: 1, // action row
        components: [
          {
            type: 3, // string select
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

app.post("/interactions", async (req, res) => {
  if (!isValidDiscordRequest(req)) return res.status(401).send("Bad signature");
  const body = req.body;

  // PING
  if (body.type === 1) return res.json({ type: 1 });

  // ------------------------------
  // /post_info -> create a normal channel message (no banner) and pin it
  // ------------------------------
  if (body.type === 2 && body.data?.name === "post_info") {
    if (!BOT_TOKEN || !INFO_CHANNEL_ID) {
      return res.json({
        type: 4,
        data: { flags: 64, content: "Missing BOT token or INFO_CHANNEL_ID env vars on the server." }
      });
    }

    // Optional: allow only admins to run this
    const perms = body.member?.permissions ?? "0";
    const isAdmin = (BigInt(perms) & (1n << 3n)) !== 0n; // ADMINISTRATOR bit
    if (!isAdmin) {
      return res.json({ type: 4, data: { flags: 64, content: "Only admins can run this." } });
    }

    const content = buildPublicContent();

    // Post the message to the channel
    const postRes = await fetch(`https://discord.com/api/v10/channels/${INFO_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ embeds: content.embeds, components: content.components })
    });
    const posted = await postRes.json();

    // Try to pin (requires Manage Messages). Ignore failures.
    try {
      await fetch(`https://discord.com/api/v10/channels/${INFO_CHANNEL_ID}/pins/${posted.id}`, {
        method: "PUT",
        headers: { "Authorization": `Bot ${BOT_TOKEN}` }
      });
    } catch {}

    // Ephemeral ack
    return res.json({
      type: 4,
      data: { flags: 64, content: `Posted${postRes.ok ? " and pinned" : ""} in <#${INFO_CHANNEL_ID}>.` }
    });
  }

  // ------------------------------
  // /donate -> (keep your original preview as a normal interaction reply)
  // ------------------------------
  if (body.type === 2 && body.data?.name === "donate") {
    const content = buildPublicContent();
    return res.json({ type: 4, data: { embeds: content.embeds, components: content.components } });
  }

  // ------------------------------
  // Dropdown -> EPHEMERAL embeds (unchanged)
  // ------------------------------
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
          {
            name: "💎 - Platinum Member",
            value:
              "- Shout out\n- Role + Colour\n- Exclusive Sneak Peeks\n- Platinum Chat\n- Platinum Call\n*Price: 200R$/month*",
            inline: true
          },
          {
            name: "💎 - Platinum Member (Lifetime)",
            value: "-\n-\n-\n-\n-\n*Price: 2200R$*",
            inline: true
          },
          {
            name: "⚜️ - Ultimate Member",
            value:
              "- Shout out\n- Role + Colour\n- Exclusive Sneak Peeks\n- Platinum **and** Ultimate Chat\n- Platinum **and** Ultimate Call\n- Ultimate Giveaways\n*Price: 400R$/month*",
            inline: false
          },
          {
            name: "🌟 - Server Booster",
            value: "- Shout out\n- Role + Colour\n- Exclusive Sneak Peeks\n- Platinum Chat\n- Platinum Call",
            inline: false
          }
        ]
      },

      applying_info: {
        color: 16711422,
        title: "Applying for a Staff or Developer position",
        description:
          "At Code Red Creations, we’re looking for active UGC developers and, from time to time, new staff members to strengthen our team. Read the information below to learn more.",
        fields: [
          {
            name: "Applying for the Staff Team",
            value:
              "As a member of the CRC Staff Team, you help ensure that everyone follows the rules and provide support by answering questions when things are unclear.\n\nInterested in joining? Keep an eye on the announcements to see when applications open!",
            inline: false
          },
          {
            name: "Applying for UGC Developer",
            value:
              "We are always looking for active and experienced UGC developers to join our Development Team. As a UGC developer, you’ll be creating a variety of unique UGC items — and you may even receive payment as a reward for your work!\n\nInterested in joining? Open a ticket in our Support channel and share your portfolio. Our team will review it and guide you through the next steps!",
            inline: false
          }
        ]
      },

      products_info: {
        color: 16711422,
        title: "Products information",
        description:
          "At Code Red Creations, we specialize in creating high-quality UGC items for Roblox. Our products are designed with detail, creativity, and community needs in mind. Whether it’s accessories, outfits, or unique items, our UGCs are made to stand out and bring extra style to your Roblox experience.\n\nYou can find all our products in <#1417530200283152465>. If you have any questions, feel free to open a ticket in the Support channel and our team will be happy to help you."
      },

      affiliation_info: {
        color: 16711422,
        title: "Affiliation information",
        description:
          "Our Affiliation Program lets communities collaborate with Code Red Creations. As an affiliate, your server gets exclusive perks while we share our creations and progress with your members.\n\nIf you would like to affiliate with us, please open a ticket in the Support channel.",
        fields: [
          {
            name: "Perks",
            value:
              "- UGCs inspired by your community\n- Priority suggestion access\n- Exclusive sneak peeks\n- Progress updates in your Sneak Peeks channel\n- Promotion in our server\n- Recognition as official affiliate",
            inline: true
          },
          {
            name: "Requirements",
            value:
              "- Active, community-focused server\n- Promote Code Red Creations visibly\n- Allow us to share progress in Sneak Peeks\n- Friendly and respectful environment\n- Open to collaboration on UGC ideas",
            inline: true
          }
        ]
      }
    };

    const picked = embedByKey[key] ?? { color: 16711422, title: "Unknown", description: "This option is not configured." };

    return res.json({ type: 4, data: { flags: 64, embeds: [picked] } });
  }

  return res.json({ type: 4, data: { content: "Unhandled.", flags: 64 } });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`CRC interactions on :${port}`));

