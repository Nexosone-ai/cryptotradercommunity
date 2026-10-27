import { readContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { listInvoices, listJobs, partnerServiceSummary } from "@/lib/video/service";

/** Everything the partner's video/billing tabs need in one call. */
export const GET = handler(async () => {
  const { db, user } = await readContext({ role: "PARTNER" });
  const summary = await partnerServiceSummary(db, user);
  return json({ ...summary, jobs: await listJobs(db, user.id), invoices: await listInvoices(db, user.id) });
});
