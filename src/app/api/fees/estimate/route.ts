import { z } from "zod";
import { apiContext } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/current";
import { getBotForViewer } from "@/lib/bots/service";
import { estimateFees, HL_BASE_PERP_FEE } from "@/lib/fees/rates";
import { handler, json, notFound } from "@/lib/http";

const query = z.object({ notional: z.coerce.number().positive().max(1e9), botId: z.string().optional() });

export const GET = handler(async (req: Request) => {
  const { db, cfg } = await apiContext();
  const p = new URL(req.url).searchParams;
  const q = query.parse({ notional: p.get("notional"), botId: p.get("botId") ?? undefined });
  let fee = cfg.manualOrderFeeTenthsBp;
  if (q.botId) {
    const found = await getBotForViewer(db, q.botId, await getCurrentUser());
    if (!found) throw notFound("봇을 찾을 수 없습니다.");
    fee = found.bot.feeTenthsBp;
  }
  return json({ estimate: estimateFees(q.notional, fee), baseFeeSource: HL_BASE_PERP_FEE.source, builder: cfg.builderAddress });
});
