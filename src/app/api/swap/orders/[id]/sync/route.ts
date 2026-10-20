import { mutationContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { getSwapReader } from "@/lib/swap/reader";
import { orderView, syncOrder } from "@/lib/swap/service";

/** Re-reads an order's fill/cancel state from the contract. */
export const POST = handler(async (req: Request, ctx: RouteContext<"/api/swap/orders/[id]/sync">) => {
  const { id } = await ctx.params;
  const { db } = await mutationContext(req, { bucket: "swap-sync", limit: 60 });
  return json({ order: orderView(await syncOrder(db, getSwapReader(), id)) });
});
