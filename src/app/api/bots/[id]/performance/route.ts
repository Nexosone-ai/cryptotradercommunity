import { apiContext } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/current";
import { getBotForViewer } from "@/lib/bots/service";
import { handler, json, notFound } from "@/lib/http";
import { getBotMetrics } from "@/lib/performance/metrics";

const PERIODS: Record<string, number | undefined> = { "7d": 7, "30d": 30, "90d": 90, all: undefined };

export const GET = handler(async (req: Request, ctx: RouteContext<"/api/bots/[id]/performance">) => {
  const { id } = await ctx.params;
  const { db } = await apiContext();
  const found = await getBotForViewer(db, id, await getCurrentUser());
  if (!found) throw notFound("봇을 찾을 수 없습니다.");
  const period = new URL(req.url).searchParams.get("period") ?? "all";
  if (!(period in PERIODS)) throw notFound("지원하지 않는 기간입니다.");
  return json({ period, metrics: await getBotMetrics(db, found.bot.id, PERIODS[period]) });
});
