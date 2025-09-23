import express from "express";
import nacl from "tweetnacl";

const app = express();
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

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

  // Ping
  if (body.type === 1) return res.json({ type: 1 });

  // Slash command: /donate
  if (body.type === 2 && body.data?.name === "donate") {
    return res.json({
      type: 4,
      data: {
        content: "Choose a tier:",
        components: [{
          type: 1,
          components: [{
            type: 3,
            custom_id: "crc_tier_select",
            placeholder: "Select a tier",
            options: [
              { label: "💎 Platinum (Monthly)", value: "platinum_mo", description: "200R$/month" },
              { label: "💎 Platinum (Lifetime)", value: "platinum_lt", description: "25000R$" },
              { label: "✝️ Ultimate", value: "ultimate_mo", description: "400R$/month" }
            ]
          }]
        }]
      }
    });
  }

  // Dropdown handler
  if (body.type === 3 && body.data?.custom_id === "crc_tier_select") {
    const choice = body.data.values?.[0];
const text = {
  platinum_mo: 
    "**💎 Platinum Member (Monthly)**\n" +
    "• Shout out\n" +
    "• Role + Colour\n" +
    "• Sneak Peeks\n" +
    "• Platinum Chat\n" +
    "• Platinum Call\n" +
    "*Price: 200R$/month*",

  platinum_lt: 
    "**💎 Platinum Member (Lifetime)**\n" +
    "• Shout out\n" +
    "• Role + Colour\n" +
    "• Sneak Peeks\n" +
    "• Platinum Chat\n" +
    "• Platinum Call\n" +
    "*Price: 2200R$*",

  ultimate_mo: 
    "**✝️ Ultimate Member**\n" +
    "• Shout out\n" +
    "• Role + Colour\n" +
    "• Sneak Peeks\n" +
    "• Platinum Chat\n" +
    "• Platinum Call\n" +
    "• Extra Giveaways\n" +
    "*Price: 400R$/month*"
}[choice] || "Unknown option.";
    return res.json({
      type: 4,
      data: { content: text, flags: 64 }
    });
  }

  return res.json({ type: 4, data: { content: "Unhandled", flags: 64 } });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on :${port}`));

