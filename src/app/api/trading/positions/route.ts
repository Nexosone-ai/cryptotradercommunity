import { readContext } from "@/lib/api";
import { ApiError, handler, json } from "@/lib/http";

export const GET = handler(async () => {
  const { hl, user } = await readContext();
  try {
    const state = (await hl.clearinghouseState(user.walletAddress)) as { assetPositions?: unknown[] };
    return json({ network: hl.network, fetchedAt: new Date().toISOString(), positions: state.assetPositions ?? [] });
  } catch {
    throw new ApiError(503, "HL_UNAVAILABLE", "포지션을 불러오지 못했습니다.");
  }
});
