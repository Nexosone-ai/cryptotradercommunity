import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { setOrderUsd } from "@/lib/engine/manage";
import { handler, json, readJson } from "@/lib/http";

const body = z.object({ orderUsd: z.number().int() });

/** Subscriber updates the amount the engine trades per signal. */
export const POST = handler(async (req: Request, ctx: RouteContext<"/api/bots/[id]/subscription">) => {
  const { id } = await ctx.params;
  const { db, user, cfg } = await mutationContext(req, { bucket: "subscribe", limit: 20 });
  return json({ subscription: await setOrderUsd(db, user, id, cfg.network, body.parse(await readJson(req)).orderUsd) });
});
