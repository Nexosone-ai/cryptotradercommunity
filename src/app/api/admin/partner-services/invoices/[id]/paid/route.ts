import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { markInvoicePaid } from "@/lib/video/service";

const body = z.object({ note: z.string().max(500).optional() });

/** Confirms the customer's transfer into the company account (amount owed to the partner). */
export const POST = handler(async (req: Request, ctx: RouteContext<"/api/admin/partner-services/invoices/[id]/paid">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 60 });
  return json({ invoice: await markInvoicePaid(db, user, id, body.parse(await readJson(req)).note) });
});
