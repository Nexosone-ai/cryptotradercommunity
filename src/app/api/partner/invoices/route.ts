import { z } from "zod";
import { mutationContext, readContext } from "@/lib/api";
import { badRequest, handler, json, readJson } from "@/lib/http";
import { usdToE8 } from "@/lib/video/models";
import { createInvoice, listInvoices } from "@/lib/video/service";
import { bi } from "@/lib/i18n";

const body = z.object({
  issuerName: z.string().max(80),
  customerName: z.string().max(80),
  description: z.string().max(1000),
  amountUsd: z.string().max(20),
  jobId: z.string().optional(),
});

export const GET = handler(async () => {
  const { db, user } = await readContext({ role: "PARTNER" });
  return json({ invoices: await listInvoices(db, user.id) });
});

/** Invoice priced by the partner; the customer pays into the company account. */
export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { role: "PARTNER", bucket: "invoice", limit: 30 });
  const b = body.parse(await readJson(req));
  let amountE8: bigint;
  try {
    amountE8 = usdToE8(b.amountUsd);
  } catch (e) {
    throw badRequest("INVALID_AMOUNT", e instanceof Error ? e.message : bi("The amount is invalid.", "금액이 올바르지 않습니다."));
  }
  return json({ invoice: await createInvoice(db, user, { ...b, amountE8, jobId: b.jobId || undefined }) }, { status: 201 });
});
