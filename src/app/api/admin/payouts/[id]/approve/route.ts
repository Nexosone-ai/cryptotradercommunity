import { mutationContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { approvePayout } from "@/lib/ledger/service";

export const POST = handler(async (req: Request, ctx: RouteContext<"/api/admin/payouts/[id]/approve">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 30 });
  return json({ payout: await approvePayout(db, user, id) });
});
