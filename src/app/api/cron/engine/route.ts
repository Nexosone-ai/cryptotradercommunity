import { apiContext } from "@/lib/api";
import { assertCron } from "@/lib/engine/cron";
import { engineAvailability, retryStaleSignals } from "@/lib/engine/execute";
import { runTrendTick } from "@/lib/engine/trend";
import { handler, json } from "@/lib/http";

export const maxDuration = 60;

/** Every minute (vercel.json): template strategies, plus signals whose first run didn't finish. */
export const GET = handler(async (req: Request) => {
  assertCron(req);
  const engine = engineAvailability();
  if (!engine.enabled) return json({ engine: "off", reason: engine.reason });
  const { db, hl } = await apiContext();
  const emitted = await runTrendTick(db, hl);
  const retried = await retryStaleSignals(db, hl);
  return json({ engine: "on", emitted, retried });
});
