/**
 * Bot engine worker (optional; long-running, for hosts other than Vercel).
 *
 * On Vercel the same work runs from Vercel Cron (/api/cron/engine, every minute)
 * and webhook signals run right after they arrive. Use this worker instead when
 * the app runs on your own server. Both are safe together: signals are deduplicated
 * and each subscriber runs at most once per signal.
 *
 * Run: npm run worker:bots   (requires DATABASE_URL and BOT_ENGINE_ENABLED=true)
 */
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { engineAvailability, retryStaleSignals } from "@/lib/engine/execute";
import { runTrendTick } from "@/lib/engine/trend";
import { getHlGateway } from "@/lib/hyperliquid/gateway";

const INTERVAL_MS = Number(process.env.BOT_ENGINE_INTERVAL_MS ?? 60_000);

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const engine = engineAvailability();
  if (!engine.enabled) {
    console.error(`[bots] not starting: ${engine.reason}`);
    process.exit(1);
  }
  const cfg = getConfig();
  const db = await getDb();
  const hl = getHlGateway(cfg.network);
  console.log(`[bots] started network=${cfg.network} interval=${INTERVAL_MS}ms`);
  while (!stopping) {
    try {
      const emitted = await runTrendTick(db, hl);
      const retried = await retryStaleSignals(db, hl);
      if (emitted.length || retried) console.log(`[bots] ${new Date().toISOString()}`, { emitted, retried });
    } catch (err) {
      console.error("[bots] tick failed", err instanceof Error ? err.message : err);
    }
    for (let t = 0; t < INTERVAL_MS && !stopping; t += 1000) await sleep(1000);
  }
  console.log("[bots] stopped");
  process.exit(0);
}

void main();
