import Decimal from "decimal.js";
import { and, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { fills, orders } from "../db/schema";

export type Verification = "VERIFIED_LIVE" | "VERIFIED_HISTORICAL" | "BACKTEST" | "INSUFFICIENT_DATA" | "UNVERIFIED";

export const VERIFICATION_LABELS: Record<Verification, string> = {
  VERIFIED_LIVE: "실거래 검증",
  VERIFIED_HISTORICAL: "과거 실거래 검증",
  BACKTEST: "백테스트 (실거래 아님)",
  INSUFFICIENT_DATA: "검증 데이터 부족",
  UNVERIFIED: "미검증",
};

/** Minimum evidence before any figure is shown as verified. */
export const MIN_CLOSING_TRADES = 20;
export const MIN_DAYS = 14;

export interface FillLike {
  time: Date;
  closedPnl: string;
  fee: string;
  builderFee: string | null;
  price: string;
  size: string;
}

export interface BotMetrics {
  verification: Verification;
  fills: number;
  closingTrades: number;
  wins: number;
  losses: number;
  winRate: string | null;
  realizedPnlUsd: string;
  feesUsd: string;
  netPnlUsd: string;
  volumeUsd: string;
  maxDrawdownUsd: string;
  avgWinLossRatio: string | null;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  /** ROI needs a capital base attributable to the bot; not available in Phase 1. */
  roi: null;
  methodology: string;
}

export const METHODOLOGY =
  "Hyperliquid 체결(userFills) 중 이 플랫폼이 봇 실행으로 전송한 주문(cloid 매핑)만 집계합니다. " +
  "실현손익 = closedPnl 합계, 순손익 = 실현손익 − 거래 수수료 − Builder 수수료. " +
  "MDD는 누적 순실현손익 곡선의 최고점 대비 최대 하락폭(USDC)입니다. 펀딩비·미실현손익은 별도이며 이 수치에 포함되지 않습니다. " +
  "수익률(ROI)은 봇에 귀속 가능한 자본 기준이 확정되는 Phase 2부터 제공하며, 입출금은 성과에서 제외(TWR)합니다. " +
  `검증 기준: 청산 체결 ${MIN_CLOSING_TRADES}건 이상, 운영 ${MIN_DAYS}일 이상.`;

export function computeMetrics(rows: FillLike[], now = new Date()): BotMetrics {
  const sorted = [...rows].sort((a, b) => a.time.getTime() - b.time.getTime());
  let realized = new Decimal(0);
  let fees = new Decimal(0);
  let volume = new Decimal(0);
  let peak = new Decimal(0);
  let maxDd = new Decimal(0);
  let equity = new Decimal(0);
  let wins = 0;
  let losses = 0;
  let sumWin = new Decimal(0);
  let sumLoss = new Decimal(0);

  for (const f of sorted) {
    const pnl = new Decimal(f.closedPnl);
    const fee = new Decimal(f.fee).plus(f.builderFee ?? 0);
    realized = realized.plus(pnl);
    fees = fees.plus(fee);
    volume = volume.plus(new Decimal(f.price).mul(f.size));
    if (!pnl.isZero()) {
      if (pnl.gt(0)) {
        wins++;
        sumWin = sumWin.plus(pnl);
      } else {
        losses++;
        sumLoss = sumLoss.plus(pnl.abs());
      }
    }
    equity = equity.plus(pnl).minus(fee);
    if (equity.gt(peak)) peak = equity;
    const dd = peak.minus(equity);
    if (dd.gt(maxDd)) maxDd = dd;
  }

  const closing = wins + losses;
  const first = sorted[0]?.time ?? null;
  const last = sorted.at(-1)?.time ?? null;
  const days = first ? (now.getTime() - first.getTime()) / 86_400_000 : 0;
  const enough = closing >= MIN_CLOSING_TRADES && days >= MIN_DAYS;

  return {
    verification: enough ? "VERIFIED_LIVE" : "INSUFFICIENT_DATA",
    fills: sorted.length,
    closingTrades: closing,
    wins,
    losses,
    winRate: closing ? new Decimal(wins).div(closing).mul(100).toFixed(1) : null,
    realizedPnlUsd: realized.toFixed(2),
    feesUsd: fees.toFixed(4),
    netPnlUsd: realized.minus(fees).toFixed(2),
    volumeUsd: volume.toFixed(2),
    maxDrawdownUsd: maxDd.toFixed(2),
    avgWinLossRatio: wins && losses ? sumWin.div(wins).div(sumLoss.div(losses)).toFixed(2) : null,
    firstTradeAt: first?.toISOString() ?? null,
    lastTradeAt: last?.toISOString() ?? null,
    roi: null,
    methodology: METHODOLOGY,
  };
}

/** Only fills of orders the bot runner sent (source = BOT) count toward a bot. */
export async function botFills(db: Db, botId: string, since?: Date) {
  const rows = await db
    .select({
      time: fills.sourceTime,
      closedPnl: fills.closedPnl,
      fee: fills.fee,
      builderFee: fills.builderFee,
      price: fills.price,
      size: fills.size,
      coin: fills.coin,
      side: fills.side,
    })
    .from(fills)
    .innerJoin(orders, eq(orders.id, fills.orderId))
    .where(and(eq(fills.botId, botId), eq(orders.source, "BOT"), since ? gte(fills.sourceTime, since) : undefined));
  return rows;
}

export async function getBotMetrics(db: Db, botId: string, periodDays?: number) {
  const since = periodDays ? new Date(Date.now() - periodDays * 86_400_000) : undefined;
  const rows = await botFills(db, botId, since);
  return computeMetrics(rows);
}
