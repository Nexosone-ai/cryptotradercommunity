import Decimal from "decimal.js";
import { and, eq, gte, isNull } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { botPositions, orders, riskEvents } from "../db/schema";
import { tradingBalance } from "../hyperliquid/balance";
import type { HlGateway } from "../hyperliquid/gateway";
import { localize } from "../i18n";
import { decryptAgentKey } from "../trading/agent-keys";
import { activeAgent, placeOrder } from "../trading/service";

/** Helpers shared by the signal engine (execute.ts) and copy trading (copy.ts). */

/** What the engine did for one subscriber on one signal. */
export type Outcome = { status: "DONE" | "SKIPPED" | "FAILED"; reason: string; orderIds: string[] };

export const message =(err: unknown) => localize(err instanceof Error ? err.message : String(err), "en");

/** Signed position size for a coin on Hyperliquid (0 when flat). */
export async function positionSize(hl: HlGateway, wallet: string, coin: string): Promise<Decimal> {
  const state = (await hl.clearinghouseState(wallet)) as { assetPositions?: { position: { coin: string; szi: string } }[] };
  const p = state.assetPositions?.find((a) => a.position.coin === coin);
  return p ? new Decimal(p.position.szi) : new Decimal(0);
}

type Side = "LONG" | "SHORT";
type OrderRow = typeof orders.$inferSelect;

/** Size of `side` in a signed position (0 if flat or on the other side). */
export const sideSize = (signed: Decimal, side: Side) => Decimal.max(side === "LONG" ? signed : signed.neg(), 0);

/**
 * How much a market order moved the position on `side` (opened, or closed when `reduce`).
 * A FILLED, REJECTED or CANCELED answer is Hyperliquid's own; with no answer
 * (ERROR, UNKNOWN) the position is read back, since the order may have filled anyway.
 */
export async function orderEffect(hl: HlGateway, wallet: string, coin: string, order: OrderRow, side: Side, before: Decimal, reduce: boolean): Promise<Decimal> {
  if (order.status === "FILLED") return new Decimal(order.filledSize ?? 0);
  if (order.status === "REJECTED" || order.status === "CANCELED") return new Decimal(0);
  const after = sideSize(await positionSize(hl, wallet, coin), side);
  const was = sideSize(before, side);
  return Decimal.max(reduce ? was.minus(after) : after.minus(was), 0);
}

/**
 * Cross margin: would the account reach Hyperliquid's maintenance margin before
 * this stop loss triggers? The stop is a price move (e.g. 20%), not a share of
 * the margin; at high leverage or a small balance, liquidation can come first.
 * Approximation: other positions are assumed not to move. Returns why, or null.
 */
export async function liquidationBeforeStop(hl: HlGateway, wallet: string, notionalUsd: Decimal.Value, stopLossPct: number, maxLeverage: number): Promise<string | null> {
  try {
    const [state, mode, spot] = await Promise.all([
      hl.clearinghouseState(wallet) as Promise<{ marginSummary?: { accountValue?: string }; crossMaintenanceMarginUsed?: string; withdrawable?: string }>,
      hl.accountMode(wallet).catch(() => null),
      hl.spotBalances(wallet).catch(() => []),
    ]);
    const usdc = spot.find((b) => b.coin === "USDC");
    const equity = new Decimal(
      tradingBalance({ mode, perpsValue: state.marginSummary?.accountValue, perpsWithdrawable: state.withdrawable, spotUsdcTotal: usdc?.total, spotUsdcHold: usdc?.hold }).value,
    );
    const notional = new Decimal(notionalUsd);
    const lossAtStop = notional.mul(stopLossPct).div(100);
    // Hyperliquid's maintenance margin is half the initial margin at the market's max leverage.
    const maintenance = new Decimal(state.crossMaintenanceMarginUsed ?? 0).plus(notional.div(2 * maxLeverage));
    if (equity.minus(lossAtStop).gte(maintenance.mul(1.5))) return null;
    return (
      `At a ${stopLossPct}% stop the loss would be about ${lossAtStop.toFixed(2)} USDC, which this account (${equity.toFixed(2)} USDC) ` +
      "can't cover above Hyperliquid's maintenance margin: the position could be liquidated before the stop triggers. Add funds or lower the amount per trade."
    );
  } catch {
    return null;
  }
}

/** A bot position the engine holds without a stop on Hyperliquid blocks new entries until it is protected or closed. */
export async function hasUnprotectedPosition(db: Db, subscriptionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: botPositions.id })
    .from(botPositions)
    .where(and(eq(botPositions.subscriptionId, subscriptionId), isNull(botPositions.stopCloid)))
    .limit(1);
  return Boolean(row);
}

export type Protection = { ok: true; cloid: string; trigger: string } | { ok: false; remaining: Decimal; reason: string };

/**
 * Reduce-only stop for a bot position. If it can't be placed the position is
 * closed (fail closed) and the close is checked on Hyperliquid: `remaining` is
 * what is still open without a stop (0 = safely closed).
 */
export async function protect(
  db: Db,
  hl: HlGateway,
  user: SessionUser,
  p: { botId: string; coin: string; side: Side; size: Decimal; entry: Decimal; stopLossPct: number },
  orderIds: string[],
): Promise<Protection> {
  const ctx = { source: "BOT" as const, botId: p.botId };
  const mainnet = { confirmMainnet: hl.network === "mainnet" };
  const sl = new Decimal(p.stopLossPct).div(100);
  const trigger = p.side === "LONG" ? p.entry.mul(new Decimal(1).minus(sl)) : p.entry.mul(sl.plus(1));
  const isBuy = p.side === "SHORT";
  let stopError = "";
  try {
    const stop = await placeOrder(db, hl, user, { coin: p.coin, isBuy, size: p.size.toString(), orderType: "STOP_MARKET", triggerPrice: trigger.toString(), reduceOnly: true, ...mainnet }, ctx);
    orderIds.push(stop.id);
    if (stop.status === "RESTING") return { ok: true, cloid: stop.cloid, trigger: trigger.toSignificantDigits(6).toString() };
    stopError = `${stop.status}${stop.error ? `: ${stop.error}` : ""}`;
  } catch (err) {
    stopError = message(err);
  }

  const flatten = await placeOrder(db, hl, user, { coin: p.coin, isBuy, size: p.size.toString(), orderType: "MARKET", reduceOnly: true, ...mainnet }, ctx).catch(() => null);
  if (flatten) orderIds.push(flatten.id);
  // Never take the close on trust: what is still open on Hyperliquid decides. Unreadable → assume all of it.
  const remaining = await positionSize(hl, user.walletAddress, p.coin)
    .then((s) => Decimal.min(sideSize(s, p.side), p.size))
    .catch(() => p.size);
  if (remaining.isZero()) {
    await db.insert(riskEvents).values({ userId: user.id, botId: p.botId, kind: "STOP_LOSS_FAILED", severity: "WARN", detail: { coin: p.coin, stopError, flattened: true } });
    return { ok: false, remaining, reason: `Stop loss couldn't be placed (${stopError}); the position was closed for safety (confirmed on Hyperliquid).` };
  }
  await db.insert(riskEvents).values({
    userId: user.id,
    botId: p.botId,
    kind: "UNPROTECTED_POSITION",
    severity: "CRITICAL",
    detail: { coin: p.coin, side: p.side, remaining: remaining.toString(), stopError, flatten: flatten ? `${flatten.status}${flatten.error ? `: ${flatten.error}` : ""}` : "ERROR" },
  });
  return {
    ok: false,
    remaining,
    reason:
      `Stop loss couldn't be placed (${stopError}) and the safety close didn't complete: ${remaining} ${p.coin} is still open without a stop. ` +
      "New entries are paused for this subscription; the engine retries the stop every minute.",
  };
}

export async function cancelStop(db: Db, hl: HlGateway, user: SessionUser, coin: string, cloid: string) {
  try {
    const agent = await activeAgent(db, user.id, hl.network);
    const asset = (await hl.perpAssets()).find((a) => a.name === coin);
    if (agent && asset) await hl.cancelByCloid(decryptAgentKey(agent.encryptedKey, agent.agentAddress), asset.index, cloid as `0x${string}`);
    await db.update(orders).set({ status: "CANCELED", updatedAt: new Date() }).where(eq(orders.cloid, cloid));
  } catch {
    // Hyperliquid drops reduce-only stops once there is nothing left to reduce.
  }
}

/** Realized PnL minus fees today (UTC) from fills of this subscription's bot orders. */
export async function realizedPnlToday(db: Db, hl: HlGateway, wallet: string, subscriptionId: string): Promise<Decimal> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const mine = await db
    .select({ cloid: orders.cloid })
    .from(orders)
    .where(and(eq(orders.subscriptionId, subscriptionId), gte(orders.createdAt, new Date(dayStart.getTime() - 7 * 86_400_000))));
  if (mine.length === 0) return new Decimal(0);
  const cloids = new Set(mine.map((o) => o.cloid.toLowerCase()));
  const fills = await hl.userFillsByTime(wallet, dayStart.getTime());
  return fills
    .filter((f) => f.cloid && cloids.has(f.cloid.toLowerCase()))
    .reduce((sum, f) => sum.plus(f.closedPnl).minus(f.fee), new Decimal(0));
}
