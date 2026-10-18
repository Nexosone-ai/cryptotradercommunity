import { readContext } from "@/lib/api";
import { feeEventsList, ledgerOverview, payablesByRecipient } from "@/lib/admin/queries";
import { handler, json } from "@/lib/http";
import { listPolicies } from "@/lib/ledger/service";

export const GET = handler(async () => {
  const { db, hl } = await readContext({ role: "ADMIN" });
  return json({
    overview: await ledgerOverview(db, hl),
    events: await feeEventsList(db),
    payables: await payablesByRecipient(db),
    policies: await listPolicies(db),
  });
});
