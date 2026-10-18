import { marketContext } from "@/lib/api";
import { ApiError, handler, json } from "@/lib/http";

export const GET = handler(async () => {
  const { hl } = marketContext();
  try {
    const markets = await hl.marketOverview();
    return json({ network: hl.network, source: "Hyperliquid info.metaAndAssetCtxs", fetchedAt: new Date().toISOString(), markets });
  } catch {
    throw new ApiError(503, "HL_UNAVAILABLE", "Hyperliquid 시장 데이터를 불러오지 못했습니다.");
  }
});
