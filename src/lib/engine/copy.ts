import Decimal from "decimal.js";
import { and, desc, eq } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import { isCopyBot, type BotConfig } from "../bots/schema";
import type { Db } from "../db/client";
import { botPositions, botSignals, botSubscriptions, bots, riskEvents, users } from "../db/schema";
import { tradingBalance } from "../hyperliquid/balance";
import type { HlGateway } from "../hyperliquid/gateway";
import { decryptAgentKey } from "../trading/agent-keys";
import { activeAgent, placeOrder } from "../trading/service";
import { cancelStop, positionSize, realizedPnlToday, type Outcome } from "./common";
import { engineAvailability, executeSignal } from "./execute";
import { MIN_ORDER_USD } from "./manage";
import { recordSignal, type TargetAction } from "./signals";

/**
 * Copy trading (docs/BOT_ENGINE.md §Copy trading).
 *
 * The leader is the owner of a COPY_TRADE bot and trades on their own
 * Hyperliquid account. Every minute the engine compares the leader's position
 * in each of the bot's markets with the last one it saw; a change becomes a
 * COPY signal. Each follower then moves the position the engine opened for
 * them to the leader's size scaled by allocation ÷ leader account value, so a
 * follower who allocates 1% of the leader's account value holds 1% of each
 * leader position (same leverage). Followers only enter positions the leader
 * opens after they subscribed; they follow adds, reductions and closes of the
 * positions they hold. Every order goes through the placeOrder gate (source
 * "BOT") and each copied position keeps a reduce-only stop loss.
 */

type Bot = typeof bots.$inferSelect;
type Subscription = typeof botSubscriptions.$inferSelect;
type Signal = typeof botSignals.$inferSelect;

/** What a COPY signal carries: the leader's position change in one coin. */
export interface CopyPayload {
  /** Leader's signed size before and after (Hyperliquid szi). */
  prev: string;
  next: string;
  /** Leader's account value when the change was seen (USDC). */
  leaderValue: string;
  /** Leader's leverage on this coin, when open. */
  leverage: number | null;
}

export type CopyPlan =
  | { kind: "SKIP"; reason: string }
  | { kind: "CLOSE" }
  /** Close what is held (if anything), then open `size` on `side`. */
  | { kind: "OPEN"; side: "LONG" | "SHORT"; size: Decimal; closeFirst: boolean }
  /** Same side as held: grow or shrink it to `size`. */
  | { kind: "ADJUST"; size: Decimal };

const sign = (d: Decimal) => (d.gt(0) ? 1 : d.lt(0) ? -1 : 0);

/**
 * Follower's target size for one leader change (pure, unit-tested).
 * `held` is the signed size the engine holds for the follower (0 if none).
 */
export function planCopy(input: {
  prev: Decimal;
  next: Decimal;
  leaderValue: Decimal;
  allocation: Decimal;
  held: Decimal;
  mid: Decimal;
  direction: BotConfig["direction"];
  maxPositionUsd: number;
}): CopyPlan {
  const { prev, next, leaderValue, allocation, held, mid, direction, maxPositionUsd } = input;
  let target = next;
  if ((direction === "LONG" && target.lt(0)) || (direction === "SHORT" && target.gt(0))) target = new Decimal(0);
  let size = new Decimal(0);
  let tooSmall = false;
  if (!target.isZero()) {
    if (leaderValue.lte(0)) return { kind: "SKIP", reason: "The leader's account value couldn't be read, so the copy size is unknown." };
    size = target.abs().mul(allocation).div(leaderValue);
    const cap = new Decimal(maxPositionUsd).div(mid);
    if (size.gt(cap)) size = cap;
    if (size.mul(mid).lt(MIN_ORDER_USD)) {
      tooSmall = true;
      size = new Decimal(0);
    }
  }
  const side = sign(target);
  const heldSide = sign(held);

  if (size.isZero()) {
    if (heldSide !== 0) return { kind: "CLOSE" };
    return {
      kind: "SKIP",
      reason: tooSmall
        ? `Your allocation is too small to copy this trade (under ${MIN_ORDER_USD} USDC, Hyperliquid's minimum).`
        : "No copied position to close.",
    };
  }
  if (heldSide === side) return { kind: "ADJUST", size };
  // A new leader position (or a flip). Followers don't join a position the leader already held.
  if (sign(prev) === sign(next) && !prev.isZero()) {
    if (heldSide !== 0) return { kind: "CLOSE" };
    return { kind: "SKIP", reason: "You started following after the leader opened this position; copying starts with the leader's next new position." };
  }
  return { kind: "OPEN", side: side > 0 ? "LONG" : "SHORT", size, closeFirst: heldSide !== 0 };
}

function payloadOf(signal: Signal): CopyPayload | null {
  const p = signal.payload as Partial<CopyPayload> | null;
  if (!p || typeof p.prev !== "string" || typeof p.next !== "string" || typeof p.leaderValue !== "string") return null;
  return { prev: p.prev, next: p.next, leaderValue: p.leaderValue, leverage: typeof p.leverage === "number" ? p.leverage : null };
}

/** Moves one follower's copied position after a COPY signal. Called from runSignal with the bot lock held. */
export async function copyToFollower(db: Db, hl: HlGateway, bot: Bot, config: BotConfig, signal: Signal, sub: Subscription): Promise<Outcome> {
  const orderIds: string[] = [];
  const payload = payloadOf(signal);
  if (!payload) return { status: "FAILED", reason: "Malformed copy signal.", orderIds };
  if (!sub.orderUsd) return { status: "SKIPPED", reason: "No copy allocation is set for this subscription.", orderIds };
  const [u] = await db.select().from(users).where(eq(users.id, sub.userId)).limit(1);
  if (!u) return { status: "FAILED", reason: "Subscriber not found.", orderIds };
  const user: SessionUser = { id: u.id, walletAddress: u.walletAddress as `0x${string}`, roles: [], sessionId: "bot-engine", chainId: 0 };
  const ctx = { source: "BOT" as const, botId: bot.id };
  const mainnet = { confirmMainnet: hl.network === "mainnet" };
  const coin = signal.coin;

  const [tracked] = await db
    .select()
    .from(botPositions)
    .where(and(eq(botPositions.subscriptionId, sub.id), eq(botPositions.coin, coin)))
    .limit(1);
  const actual = await positionSize(hl, user.walletAddress, coin);
  let held = new Decimal(0);
  if (tracked) {
    const s = tracked.side === "LONG" ? 1 : -1;
    // The stop may have fired or the user closed it: only what is still open on Hyperliquid counts.
    if (actual.mul(s).gt(0)) held = Decimal.min(new Decimal(tracked.size), actual.abs()).mul(s);
    else await db.delete(botPositions).where(eq(botPositions.id, tracked.id));
  }

  const asset = (await hl.perpAssets()).find((a) => a.name === coin);
  const midRaw = (await hl.mids())[coin];
  if (!asset || !midRaw) return { status: "FAILED", reason: `No market data for ${coin}.`, orderIds };
  const mid = new Decimal(midRaw);
  const plan = planCopy({
    prev: new Decimal(payload.prev),
    next: new Decimal(payload.next),
    leaderValue: new Decimal(payload.leaderValue),
    allocation: new Decimal(sub.orderUsd),
    held,
    mid,
    direction: config.direction,
    maxPositionUsd: config.risk.maxPositionUsd,
  });
  if (plan.kind === "SKIP") return { status: "SKIPPED", reason: plan.reason, orderIds };

  const heldSide: "LONG" | "SHORT" = held.gt(0) ? "LONG" : "SHORT";
  // Largest single order the gate accepts for this bot, with a little room for price moves.
  const maxOrderSize = new Decimal(config.risk.maxOrderUsd).mul(0.98).div(mid);
  const market = (isBuy: boolean, size: Decimal, reduceOnly = false) =>
    placeOrder(db, hl, user, { coin, isBuy, size: size.toString(), orderType: "MARKET", ...(reduceOnly ? { reduceOnly: true } : {}), ...mainnet }, ctx);

  // 1. Close the copied position (whole close, or before a flip).
  let note = "";
  if (plan.kind === "CLOSE" || (plan.kind === "OPEN" && plan.closeFirst)) {
    const close = await market(held.lt(0), held.abs(), true);
    orderIds.push(close.id);
    if (close.status !== "FILLED") return { status: "FAILED", reason: `Close order ${close.status}${close.error ? `: ${close.error}` : ""}`, orderIds };
    if (tracked?.stopCloid) await cancelStop(db, hl, user, coin, tracked.stopCloid);
    if (tracked) await db.delete(botPositions).where(eq(botPositions.id, tracked.id));
    note = `Closed ${heldSide.toLowerCase()} ${close.filledSize ?? held.abs()} ${coin}. `;
    if (plan.kind === "CLOSE") return { status: "DONE", reason: note.trim(), orderIds };
  }

  // 2. Growing a position: the daily loss limit and leverage apply.
  const grows = plan.kind === "OPEN" || plan.size.gt(held.abs());
  if (grows) {
    const pnl = await realizedPnlToday(db, hl, user.walletAddress, sub.id);
    if (pnl.lte(-config.risk.dailyLossLimitUsd)) {
      await db.insert(riskEvents).values({ userId: user.id, botId: bot.id, kind: "DAILY_LOSS_LIMIT", severity: "WARN", detail: { pnl: pnl.toFixed(2), limit: config.risk.dailyLossLimitUsd } });
      return { status: "SKIPPED", reason: `${note}Daily loss limit reached (${pnl.toFixed(2)} USDC today); no new or larger positions until tomorrow (UTC).`, orderIds };
    }
    const agent = await activeAgent(db, user.id, hl.network);
    if (agent) {
      const lev = Math.max(1, Math.min(payload.leverage ?? config.risk.maxLeverage, config.risk.maxLeverage, asset.maxLeverage));
      // Best effort: the gate's notional limits bound the risk even if this fails.
      await hl
        .updateLeverage(decryptAgentKey(agent.encryptedKey, agent.agentAddress), asset.index, lev)
        .catch((err) => db.insert(riskEvents).values({ userId: user.id, botId: bot.id, kind: "LEVERAGE_UPDATE_FAILED", severity: "INFO", detail: { message: String(err) } }));
    }
  }

  if (plan.kind === "OPEN") {
    const size = Decimal.min(plan.size, maxOrderSize);
    const open = await market(plan.side === "LONG", size);
    orderIds.push(open.id);
    if (open.status !== "FILLED" || !open.filledSize || new Decimal(open.filledSize).lte(0)) {
      return { status: "FAILED", reason: `${note}Open order ${open.status}${open.error ? `: ${open.error}` : ""}`, orderIds };
    }
    const filled = new Decimal(open.filledSize);
    const entry = new Decimal(open.avgPrice ?? mid);
    const stop = await protect(db, hl, user, bot, config, coin, plan.side, filled, entry, orderIds, ctx, mainnet);
    if (!stop.ok) return { status: "FAILED", reason: `${note}${stop.reason}`, orderIds };
    await db.insert(botPositions).values({ subscriptionId: sub.id, coin, side: plan.side, size: filled.toString(), entryPrice: entry.toString(), stopCloid: stop.cloid, openedAt: new Date() });
    return { status: "DONE", reason: `${note}Opened ${plan.side.toLowerCase()} ${filled} ${coin} at ${entry}; stop loss at ${stop.trigger}.`, orderIds };
  }

  // 3. ADJUST: same side, new size.
  const current = held.abs();
  const delta = plan.size.minus(current);
  if (delta.abs().mul(mid).lt(MIN_ORDER_USD)) return { status: "SKIPPED", reason: "The leader's change is too small to copy at your allocation.", orderIds };
  const side = heldSide;
  const increase = delta.gt(0);
  const step = increase ? Decimal.min(delta, maxOrderSize) : delta.abs();
  const order = await market(increase === (side === "LONG"), step, !increase);
  orderIds.push(order.id);
  if (order.status !== "FILLED" || !order.filledSize) return { status: "FAILED", reason: `${increase ? "Add" : "Reduce"} order ${order.status}${order.error ? `: ${order.error}` : ""}`, orderIds };
  const filled = new Decimal(order.filledSize);
  const newSize = increase ? current.plus(filled) : Decimal.max(current.minus(filled), 0);
  const oldEntry = new Decimal(tracked!.entryPrice);
  const entry = increase ? oldEntry.mul(current).plus(new Decimal(order.avgPrice ?? mid).mul(filled)).div(newSize) : oldEntry;
  // New stop for the new size first, then drop the old one, so the position is never unprotected.
  const stop = await protect(db, hl, user, bot, config, coin, side, newSize, entry, orderIds, ctx, mainnet);
  if (tracked!.stopCloid) await cancelStop(db, hl, user, coin, tracked!.stopCloid);
  if (!stop.ok) {
    await db.delete(botPositions).where(eq(botPositions.id, tracked!.id));
    return { status: "FAILED", reason: stop.reason, orderIds };
  }
  await db
    .update(botPositions)
    .set({ size: newSize.toString(), entryPrice: entry.toString(), stopCloid: stop.cloid })
    .where(eq(botPositions.id, tracked!.id));
  return {
    status: "DONE",
    reason: `${increase ? "Added" : "Reduced"} ${filled} ${coin}: ${side.toLowerCase()} ${newSize} ${coin} now; stop loss at ${stop.trigger}.`,
    orderIds,
  };
}

/** Reduce-only stop for the whole copied position. No stop → the position is closed (fail closed). */
async function protect(
  db: Db,
  hl: HlGateway,
  user: SessionUser,
  bot: Bot,
  config: BotConfig,
  coin: string,
  side: "LONG" | "SHORT",
  size: Decimal,
  entry: Decimal,
  orderIds: string[],
  ctx: { source: "BOT"; botId: string },
  mainnet: { confirmMainnet: boolean },
): Promise<{ ok: true; cloid: string; trigger: string } | { ok: false; reason: string }> {
  const sl = new Decimal(config.risk.stopLossPct).div(100);
  const trigger = side === "LONG" ? entry.mul(new Decimal(1).minus(sl)) : entry.mul(sl.plus(1));
  let stopError = "";
  try {
    const stop = await placeOrder(db, hl, user, { coin, isBuy: side === "SHORT", size: size.toString(), orderType: "STOP_MARKET", triggerPrice: trigger.toString(), reduceOnly: true, ...mainnet }, ctx);
    orderIds.push(stop.id);
    if (stop.status === "RESTING") return { ok: true, cloid: stop.cloid, trigger: trigger.toSignificantDigits(6).toString() };
    stopError = `${stop.status}${stop.error ? `: ${stop.error}` : ""}`;
  } catch (err) {
    stopError = err instanceof Error ? err.message : String(err);
  }
  const flatten = await placeOrder(db, hl, user, { coin, isBuy: side === "SHORT", size: size.toString(), orderType: "MARKET", reduceOnly: true, ...mainnet }, ctx).catch(() => null);
  if (flatten) orderIds.push(flatten.id);
  await db.insert(riskEvents).values({ userId: user.id, botId: bot.id, kind: "STOP_LOSS_FAILED", severity: "WARN", detail: { coin, stopError, flattened: flatten?.status ?? "ERROR" } });
  return { ok: false, reason: `Stop loss couldn't be placed (${stopError}); the copied position was closed for safety.` };
}

interface LeaderPosition {
  position: { coin: string; szi: string; leverage?: { value?: number } };
}

/**
 * One pass over every LIVE copy-trading bot: records a COPY signal for each
 * change in the leader's positions and runs it for the followers. The first
 * time a market is seen only the leader's current size is recorded (baseline).
 */
export async function runCopyTick(db: Db, hl: HlGateway) {
  if (!engineAvailability().enabled) return [];
  const live = await db.select().from(bots).where(eq(bots.status, "LIVE"));
  const emitted: { botId: string; coin: string; action: TargetAction }[] = [];
  for (const bot of live) {
    const config = bot.config as BotConfig;
    if (!isCopyBot(config)) continue;
    try {
      const leader = bot.ownerWalletAddress;
      const [state, mode, spot] = await Promise.all([
        hl.clearinghouseState(leader) as Promise<{ assetPositions?: LeaderPosition[]; marginSummary?: { accountValue?: string }; withdrawable?: string }>,
        hl.accountMode(leader).catch(() => null),
        hl.spotBalances(leader).catch(() => []),
      ]);
      const usdc = spot.find((b) => b.coin === "USDC");
      const leaderValue = tradingBalance({
        mode,
        perpsValue: state.marginSummary?.accountValue,
        perpsWithdrawable: state.withdrawable,
        spotUsdcTotal: usdc?.total,
        spotUsdcHold: usdc?.hold,
      }).value;
      const positions = new Map((state.assetPositions ?? []).map((p) => [p.position.coin, p.position]));
      for (const market of config.markets) {
        const coin = market.replace(/-PERP$/, "");
        const pos = positions.get(coin);
        const next = new Decimal(pos?.szi ?? "0");
        const action: TargetAction = next.gt(0) ? "LONG" : next.lt(0) ? "SHORT" : "FLAT";
        const [last] = await db
          .select()
          .from(botSignals)
          .where(and(eq(botSignals.botId, bot.id), eq(botSignals.network, hl.network), eq(botSignals.source, "COPY"), eq(botSignals.coin, coin)))
          .orderBy(desc(botSignals.createdAt))
          .limit(1);
        const payload: CopyPayload = { prev: next.toString(), next: next.toString(), leaderValue, leverage: pos?.leverage?.value ?? null };
        if (!last) {
          await db
            .insert(botSignals)
            .values({
              botId: bot.id,
              network: hl.network,
              source: "COPY",
              action,
              coin,
              dedupeKey: `copy:${coin}:baseline`,
              payload,
              status: "IGNORED",
              error: "Started watching the leader. Positions already open aren't copied; copying starts with the leader's next change.",
              processedAt: new Date(),
            })
            .onConflictDoNothing();
          continue;
        }
        const prev = new Decimal((last.payload as Partial<CopyPayload> | null)?.next ?? "0");
        if (prev.eq(next)) continue;
        const signal = await recordSignal(db, {
          botId: bot.id,
          network: hl.network,
          source: "COPY",
          action,
          coin,
          dedupeKey: `copy:${coin}:after:${last.id}`,
          payload: { ...payload, prev: prev.toString() },
        });
        if (!signal) continue;
        emitted.push({ botId: bot.id, coin, action });
        await executeSignal(db, hl, signal.id);
      }
    } catch (err) {
      console.error("[engine] copy tick failed", bot.slug, err instanceof Error ? err.message : err);
    }
  }
  return emitted;
}
