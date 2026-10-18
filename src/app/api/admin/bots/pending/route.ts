import { readContext } from "@/lib/api";
import { assessBotRisk } from "@/lib/bots/risk";
import type { BotConfig } from "@/lib/bots/schema";
import { listPendingBots } from "@/lib/bots/service";
import { handler, json } from "@/lib/http";

export const GET = handler(async () => {
  const { db, cfg } = await readContext({ role: "ADMIN" });
  const bots = await listPendingBots(db);
  return json({
    bots: bots.map((b) => ({ ...b, risk: assessBotRisk(b.config as BotConfig, cfg.platformMaxFeeTenthsBp) })),
  });
});
