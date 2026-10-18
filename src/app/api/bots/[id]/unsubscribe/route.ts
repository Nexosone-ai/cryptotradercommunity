import { mutationContext } from "@/lib/api";
import { unsubscribe } from "@/lib/bots/service";
import { handler, json } from "@/lib/http";

export const POST = handler(async (req: Request, ctx: RouteContext<"/api/bots/[id]/unsubscribe">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { bucket: "subscribe", limit: 20 });
  return json({ subscription: await unsubscribe(db, user, id) });
});
