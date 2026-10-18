import { readContext } from "@/lib/api";
import { ApiError, handler, json } from "@/lib/http";
import { refreshBuilderApproval } from "@/lib/trading/service";

/** Current builder-fee approval, read live from Hyperliquid. */
export const GET = handler(async () => {
  const { db, hl, user, cfg } = await readContext();
  try {
    const r = await refreshBuilderApproval(db, hl, user);
    return json({ ...r, network: hl.network, platformMaxTenthsBp: cfg.platformMaxFeeTenthsBp, checkedAt: new Date().toISOString() });
  } catch {
    throw new ApiError(503, "HL_UNAVAILABLE", "Hyperliquid에서 승인 상태를 확인하지 못했습니다.");
  }
});
