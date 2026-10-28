import { mutationContext } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { ApiError, handler, json } from "@/lib/http";
import { syncAllAccounts } from "@/lib/settlement/ingest";
import { bi } from "@/lib/i18n";

/** Manual trigger of the fill → fee-event ingestion (the worker runs the same code). */
export const POST = handler(async (req: Request) => {
  const { db, hl, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin-sync", limit: 6 });
  try {
    const result = await syncAllAccounts(db, hl);
    await writeAudit(db, { actorUserId: user.id, actorWallet: user.walletAddress, action: "FILL_SYNC", after: result });
    return json(result);
  } catch {
    throw new ApiError(503, "HL_UNAVAILABLE", bi("Couldn't sync fills from Hyperliquid.", "Hyperliquid 체결 동기화에 실패했습니다."));
  }
});
