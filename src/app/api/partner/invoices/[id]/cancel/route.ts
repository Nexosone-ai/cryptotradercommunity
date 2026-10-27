import { mutationContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { cancelInvoice } from "@/lib/video/service";

export const POST = handler(async (req: Request, ctx: RouteContext<"/api/partner/invoices/[id]/cancel">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { role: "PARTNER", bucket: "invoice", limit: 30 });
  return json({ invoice: await cancelInvoice(db, user, id) });
});
