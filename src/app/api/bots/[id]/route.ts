import { apiContext, mutationContext } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/current";
import { getBotForViewer, listBotVersions, updateBot } from "@/lib/bots/service";
import { handler, json, notFound, readJson } from "@/lib/http";
import { getBotMetrics } from "@/lib/performance/metrics";

export const GET = handler(async (_req: Request, ctx: RouteContext<"/api/bots/[id]">) => {
  const { id } = await ctx.params;
  const { db } = await apiContext();
  const viewer = await getCurrentUser();
  const found = await getBotForViewer(db, id, viewer);
  if (!found) throw notFound("봇을 찾을 수 없습니다.");
  return json({
    bot: found.bot,
    metrics: await getBotMetrics(db, found.bot.id),
    versions: found.isOwner || found.isAdmin ? await listBotVersions(db, found.bot.id) : undefined,
  });
});

export const PATCH = handler(async (req: Request, ctx: RouteContext<"/api/bots/[id]">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { bucket: "bot-update", limit: 20 });
  return json(await updateBot(db, user, id, await readJson(req)));
});
