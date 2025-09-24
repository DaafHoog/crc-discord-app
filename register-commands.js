// register-commands.js
// Registers guild commands for your app.
// Uses env: DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN

const APP_ID   = process.env.DISCORD_APPLICATION_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const TOKEN    = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !GUILD_ID || !TOKEN) {
  console.error("Missing env vars. Need DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN");
  process.exit(1);
}

// NOTE: We're using simple chat input commands (type 1).
// /gstart will open a modal in your interaction handler (src-giveaways.js).
const commands = [
  {
    name: "donate",
    description: "Show Code Red Creations info & categories"
  },
  {
    name: "post_info",
    description: "Post the permanent info embeds in the configured channel (admin only)"
  },
  {
    name: "gstart",
    description: "Start a giveaway (opens a form)"
    // If you want Discord to restrict who can run it at the permission level, uncomment next line:
    // default_member_permissions: "0", // means nobody by default; you would grant per-role in server
  }
  // We'll add /gend and /greroll later.
];

const url = `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;

async function main() {
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bot ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commands)
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("Failed to register commands:", res.status, text);
    process.exit(1);
  }
  console.log("Slash commands registered:", text);
}

main().catch(err => {
  console.error("Error registering commands:", err);
  process.exit(1);
});
