import { readContext } from "@/lib/api";
import { ApiError, handler, json } from "@/lib/http";

export const GET = handler(async () => {
  const { hl, user } = await readContext();
  try {
    const fills = await hl.userFills(user.walletAddress);
    return json({ network: hl.network, fetchedAt: new Date().toISOString(), fills: fills.slice(0, 100) });
  } catch {
    throw new ApiError(503, "HL_UNAVAILABLE", "체결 내역을 불러오지 못했습니다.");
  }
});
