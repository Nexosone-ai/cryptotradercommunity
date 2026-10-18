import { mutationContext, apiContext } from "@/lib/api";
import { listPublicBots, type BotListFilter } from "@/lib/bots/queries";
import { createBot } from "@/lib/bots/service";
import { handler, json, readJson } from "@/lib/http";

export const GET = handler(async (req: Request) => {
  const { db } = await apiContext();
  const p = new URL(req.url).searchParams;
  const filter: BotListFilter = {
    q: p.get("q")?.slice(0, 60) || undefined,
    strategy: p.get("strategy") || undefined,
    market: p.get("market") || undefined,
    verifiedOnly: p.get("verified") === "1",
    maxFeeTenthsBp: p.get("maxFee") ? Number(p.get("maxFee")) : undefined,
    sort: (p.get("sort") as BotListFilter["sort"]) || "newest",
  };
  return json({ bots: await listPublicBots(db, filter) });
});

export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { bucket: "bot-create", limit: 10 });
  const { bot, risk } = await createBot(db, user, await readJson(req));
  return json({ bot, risk }, { status: 201 });
});
