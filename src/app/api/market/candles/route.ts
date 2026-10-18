import { z } from "zod";
import { marketContext } from "@/lib/api";
import { ApiError, handler, json } from "@/lib/http";

const INTERVAL_MS = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "1h": 3600e3, "4h": 14400e3, "1d": 86400e3 } as const;
const query = z.object({
  coin: z.string().regex(/^[A-Z0-9]{1,15}$/),
  interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("1h"),
});

export const GET = handler(async (req: Request) => {
  const { hl } = marketContext();
  const p = new URL(req.url).searchParams;
  const { coin, interval } = query.parse({ coin: p.get("coin"), interval: p.get("interval") ?? undefined });
  try {
    const candles = await hl.candles(coin, interval, Date.now() - INTERVAL_MS[interval] * 300);
    return json({ network: hl.network, coin, interval, fetchedAt: new Date().toISOString(), candles });
  } catch {
    throw new ApiError(503, "HL_UNAVAILABLE", "캔들 데이터를 불러오지 못했습니다.");
  }
});
