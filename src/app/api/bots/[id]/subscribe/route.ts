import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { subscribe } from "@/lib/bots/service";
import { handler, json, readJson } from "@/lib/http";

const body = z.object({ acceptedFeeTenthsBp: z.number().int().min(0), acceptRisk: z.boolean() });

export const POST = handler(async (req: Request, ctx: RouteContext<"/api/bots/[id]/subscribe">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { bucket: "subscribe", limit: 20 });
  return json({ subscription: await subscribe(db, user, id, body.parse(await readJson(req))) });
});
