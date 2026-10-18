import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { markPayoutPaid } from "@/lib/ledger/service";

const body = z.object({ txHash: z.string() });

/** Records a manually executed transfer (no automatic sending in Phase 1). */
export const POST = handler(async (req: Request, ctx: RouteContext<"/api/admin/payouts/[id]/paid">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 30 });
  return json({ payout: await markPayoutPaid(db, user, id, body.parse(await readJson(req)).txHash) });
});
