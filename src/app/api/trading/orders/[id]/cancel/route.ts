import { mutationContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { cancelOrder } from "@/lib/trading/service";

export const POST = handler(async (req: Request, ctx: RouteContext<"/api/trading/orders/[id]/cancel">) => {
  const { id } = await ctx.params;
  const { db, hl, user } = await mutationContext(req, { bucket: "order-cancel", limit: 60 });
  return json({ order: await cancelOrder(db, hl, user, id) });
});
