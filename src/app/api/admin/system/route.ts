import { readContext } from "@/lib/api";
import { recentRiskEvents, systemStatus } from "@/lib/admin/queries";
import { handler, json } from "@/lib/http";

export const GET = handler(async () => {
  const { db, hl } = await readContext({ role: "ADMIN" });
  return json({ status: await systemStatus(hl), riskEvents: await recentRiskEvents(db) });
});
