import { apiContext } from "@/lib/api";
import { runCopyTick } from "@/lib/engine/copy";
import { assertCron } from "@/lib/engine/cron";
import { engineAvailability, retryStaleSignals } from "@/lib/engine/execute";
import { recordHeartbeat, runSafetyTick } from "@/lib/engine/guard";
import { runTrendTick } from "@/lib/engine/trend";
import { handler, json } from "@/lib/http";

export const maxDuration = 60;

/** Every minute (vercel.json): template strategies, copy-trading leaders, signals whose first run didn't finish, then the safety pass (orders without an answer, stops of held positions). */
export const GET = handler(async (req: Request) => {
  assertCron(req);
  const engine = engineAvailability();
  if (!engine.enabled) return json({ engine: "off", reason: engine.reason });
  const { db, hl } = await apiContext();
  await recordHeartbeat(db, hl.network);
  const emitted = await runTrendTick(db, hl);
  const copied = await runCopyTick(db, hl);
  const retried = await retryStaleSignals(db, hl);
  const safety = await runSafetyTick(db, hl);
  return json({ engine: "on", emitted, copied, retried, safety });
});
