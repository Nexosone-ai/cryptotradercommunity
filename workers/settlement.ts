/**
 * Settlement worker (long-running; deploy separately from Vercel).
 *
 * Every interval it pulls recent Hyperliquid fills for each trading account,
 * stores fills of platform orders and records OBSERVED builder-fee events.
 * Idempotent: re-processing the same fills writes nothing new.
 * Confirmation/allocation and payouts stay manual (admin) in Phase 1.
 *
 * Run: npm run worker:settlement   (requires DATABASE_URL for shared Postgres)
 */
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { riskEvents } from "@/lib/db/schema";
import { getHlGateway } from "@/lib/hyperliquid/gateway";
import { syncAllAccounts } from "@/lib/settlement/ingest";

const INTERVAL_MS = Number(process.env.SETTLEMENT_INTERVAL_MS ?? 60_000);
const MAX_BACKOFF_MS = 10 * 60_000;

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = getConfig();
  if (!cfg.databaseConfigured) {
    console.warn("[settlement] DATABASE_URL not set — using local PGlite. Do not run alongside `next dev` on the same data dir.");
  }
  const db = await getDb();
  const hl = getHlGateway(cfg.network);
  console.log(`[settlement] started network=${cfg.network} interval=${INTERVAL_MS}ms`);
  let failures = 0;
  while (!stopping) {
    try {
      const r = await syncAllAccounts(db, hl);
      failures = 0;
      if (r.newFills || r.newFeeEvents) console.log(`[settlement] ${new Date().toISOString()}`, r);
    } catch (err) {
      failures++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[settlement] sync failed (${failures})`, message);
      await db
        .insert(riskEvents)
        .values({ kind: "SETTLEMENT_SYNC_FAILED", severity: failures >= 3 ? "WARN" : "INFO", detail: { message, failures } })
        .catch(() => {});
    }
    const wait = failures ? Math.min(INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS) : INTERVAL_MS;
    for (let t = 0; t < wait && !stopping; t += 1000) await sleep(1000);
  }
  console.log("[settlement] stopped");
  process.exit(0);
}

void main();
