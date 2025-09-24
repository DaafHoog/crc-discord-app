import express from "express";
import nacl from "tweetnacl";

const app = express();
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

// Keep raw body for signature verification
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

app.post("/interactions", (req, res) => {
  if (!isValidDiscordRequest(req)) return res.status(401).send("Bad signature");
  const body = req.body;

  // PING
  if (body.type === 1) return res.json({ type: 1 });

  // =========================
  // Slash command: /donate
  // -> PUBLIC message (two embeds) + dropdown
  // =========================
  if (body.type === 2 && body.data?.name === "donate") {
    return res.json({
      type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
      data: {
        embeds: [
          {
            // Public embed no.1 (image)
            color: 16711422, // #FEFEFE
            image: {
              // Your public image. If this ever doesn’t show, switch to the direct .png/.jpg link from ibb.
              url: "https://ibb.co/h1709C07"
            }
          },
          {
            // Public embed no.2 (fields + instruction)
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
      }
    });
  }

  // =========================
  // Component interaction: dropdown -> EPHEMERAL embeds
  // =========================
  if (body.type === 3 && body.data?.custom_id === "crc_info_select") {
    const key = body.data.values?.[0];

    // ----- Ephemeral embed content by key -----
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
              "- Shout out\n" +
              "- Role + Colour\n" +
              "- Exclusive Sneak Peeks\n" +
              "- Platinum Chat\n" +
              "- Platinum Call\n" +
              "*Price: 200R$/month*",
            inline: true
          },
          {
            name: "💎 - Platinum Member (Lifetime)",
            // You asked for visible empty lines. Discord collapses pure empty lines sometimes;
            // using dashes keeps spacing readable.
            value:
              '\u200B' +
              '\u200B' +
              '\u200B' +
              '\u200B' +
              '\u200B' +
              "*Price: 2200R$*",
            inline: true
          },
          {
            name: '\u200B',
            value: '\u200B'
            inline: true
          },
          {
            name: "⚜️ - Ultimate Member",
            value:
              "- Shout out\n" +
              "- Role + Colour\n" +
              "- Exclusive Sneak Peeks\n" +
              "- Platinum **and** Ultimate Chat\n" +
              "- Platinum **and** Ultimate Call\n" +
              "- Ultimate Giveaways\n" +
              "*Price: 400R$/month*",
            inline: true
          },
          {
            name: "🌟 - Server Booster",
            value:
              "- Shout out\n" +
              "- Role + Colour\n" +
              "- Exclusive Sneak Peeks\n" +
              "- Platinum Chat\n" +
              "- Platinum Call",
            inline: true
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
              "As a member of the CRC Staff Team, you help ensure that everyone follows the rules and provide support by answering questions when things are unclear.\n\n" +
              "Interested in joining? Keep an eye on the announcements to see when applications open!",
            inline: false
          },
          {
            name: "Applying for UGC Developer",
            value:
              "We are always looking for active and experienced UGC developers to join our Development Team. As a UGC developer, you’ll be creating a variety of unique UGC items — and you may even receive payment as a reward for your work!\n\n" +
              "Interested in joining? Open a ticket in our Support channel and share your portfolio. Our team will review it and guide you through the next steps!",
            inline: false
          }
        ]
      },

      products_info: {
        color: 16711422,
        title: "Products information",
        description:
          "At Code Red Creations, we specialize in creating high-quality UGC items for Roblox. Our products are designed with detail, creativity, and community needs in mind. Whether it’s accessories, outfits, or unique items, our UGCs are made to stand out and bring extra style to your Roblox experience.\n\n" +
          "You can find all our products in <#1417530200283152465>. If you have any questions, feel free to open a ticket in the Support channel and our team will be happy to help you."
      },

      affiliation_info: {
        color: 16711422,
        title: "Affiliation information",
        description:
          "Our Affiliation Program lets communities collaborate with Code Red Creations. As an affiliate, your server gets exclusive perks while we share our creations and progress with your members.\n\n" +
          "If you would like to affiliate with us, please open a ticket in the Support channel.",
        fields: [
          {
            name: "Perks",
            value:
              "- UGCs inspired by your community\n" +
              "- Priority suggestion access\n" +
              "- Exclusive sneak peeks\n" +
              "- Progress updates in your Sneak Peeks channel\n" +
              "- Promotion in our server\n" +
              "- Recognition as official affiliate",
            inline: true
          },
          {
            name: "Requirements",
            value:
              "- Active, community-focused server\n" +
              "- Promote Code Red Creations visibly\n" +
              "- Allow us to share progress in Sneak Peeks\n" +
              "- Friendly and respectful environment\n" +
              "- Open to collaboration on UGC ideas",
            inline: true
          }
        ]
      }
    };

    const picked = embedByKey[key] ?? {
      color: 16711422,
      title: "Unknown",
      description: "This option is not configured."
    };

    return res.json({
      type: 4, // message with source
      data: {
        flags: 64, // EPHEMERAL
        embeds: [ picked ]
      }
    });
  }

  // Fallback
  return res.json({ type: 4, data: { content: "Unhandled.", flags: 64 } });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`CRC interactions on :${port}`));

