// src-cleanup.js
import { query } from "./src-database.js";

const RETENTION_DAYS = Math.max(1, parseInt(process.env.G_RETENTION_DAYS || "7", 10));
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Optional: small jitter (0–5 min) so multiple instances don't collide exactly
const JITTER_MS = Math.floor(Math.random() * 5 * 60 * 1000);

async function runCleanup() {
  try {
    const preview = await query(
      `SELECT COUNT(*)::int AS n
         FROM giveaways
        WHERE status <> 'running'
          AND ends_at < NOW() - make_interval(days => $1::int)`,
      [RETENTION_DAYS]
    );
    const n = preview.rows?.[0]?.n ?? 0;
    console.log(`[cleanup] eligible: ${n} older than ${RETENTION_DAYS} day(s)`);

    if (n > 0) {
      const del = await query(
        `DELETE FROM giveaways
          WHERE status <> 'running'
            AND ends_at < NOW() - make_interval(days => $1::int)`,
        [RETENTION_DAYS]
      );
      console.log(`[cleanup] deleted: ${del.rowCount} giveaway(s) (entries removed via CASCADE)`);
    }
  } catch (err) {
    console.error("[cleanup] error:", err);
  }
}

export function startCleanupScheduler() {
  // Run once on boot (optional)
  runCleanup().catch(() => {});
  // Then daily (+ jitter)
  setTimeout(() => {
    runCleanup().catch(() => {});
    setInterval(() => runCleanup().catch(() => {}), ONE_DAY_MS);
  }, JITTER_MS);
}
