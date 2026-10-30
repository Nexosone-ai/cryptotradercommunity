import Decimal from "decimal.js";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import { stageNotionalUsd } from "../bots/scenario";
import { isCopyBot, type BotConfig } from "../bots/schema";
import { getConfig } from "../config";
import type { Db } from "../db/client";
import { botExecutions, botPositions, botSignals, botSubscriptions, bots, engineLocks, riskEvents, users } from "../db/schema";
import { ApiError } from "../http";
import type { HlGateway } from "../hyperliquid/gateway";
import { decryptAgentKey } from "../trading/agent-keys";
import { activeAgent, placeOrder } from "../trading/service";
import {
  cancelStop,
  hasUnprotectedPosition,
  liquidationBeforeStop,
  message,
  orderEffect,
  positionSize,
  protect,
  realizedPnlToday,
  type Outcome,
} from "./common";
import { copyToFollower } from "./copy";
import { stageOf, type TargetAction } from "./signals";

/**
 * Bot execution engine (docs/BOT_ENGINE.md).
 *
 * A signal names a target position (LONG / SHORT / FLAT) for one coin. For each
 * active subscriber the engine moves the position *it opened* toward that
 * target: close the opposite side, then open a new position of the
 * subscriber's amount per trade with a reduce-only stop loss on Hyperliquid.
 * Every order goes through the placeOrder gate (source "BOT"), so fee caps,
 * consent, permissions and limits are enforced there as for any order.
 */

/** Subscribers handled per signal; more than this needs the queue worker (docs/BOT_ENGINE.md). */
const MAX_SUBSCRIBERS_PER_SIGNAL = 200;

type Bot = typeof bots.$inferSelect;
type Subscription = typeof botSubscriptions.$inferSelect;
type Signal = typeof botSignals.$inferSelect;

export function engineAvailability(): { enabled: boolean; reason: string | null } {
  const cfg = getConfig();
  if (cfg.isMainnet && !cfg.mainnetTradingEnabled) return { enabled: false, reason: "Mainnet trading isn't enabled, so bots place no orders." };
  if (!cfg.botEngineEnabled) return { enabled: false, reason: "The bot engine is turned off (BOT_ENGINE_ENABLED)." };
  if (!cfg.agentKeyConfigured) return { enabled: false, reason: "Agent key encryption isn't configured on the server." };
  return { enabled: true, reason: null };
}

/** A LONG-only bot treats SHORT as "close"; a SHORT-only bot treats LONG as "close". */
export function applyDirection(action: TargetAction, direction: BotConfig["direction"]): TargetAction {
  if (direction === "LONG" && action === "SHORT") return "FLAT";
  if (direction === "SHORT" && action === "LONG") return "FLAT";
  return action;
}

/** Signals of one bot run one at a time, so two signals never act on the same positions together. */
const LOCK_TTL_MS = 90_000;
const LOCK_WAIT_MS = 40_000;

export async function acquireLock(db: Db, key: string, holder: string): Promise<boolean> {
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
  const rows = await db
    .insert(engineLocks)
    .values({ key, holder, expiresAt })
    .onConflictDoUpdate({ target: engineLocks.key, set: { holder, expiresAt }, setWhere: lt(engineLocks.expiresAt, sql`now()`) })
    .returning();
  return rows.length > 0 && rows[0].holder === holder;
}

export async function releaseLock(db: Db, key: string, holder: string) {
  await db.delete(engineLocks).where(and(eq(engineLocks.key, key), eq(engineLocks.holder, holder)));
}

/**
 * Runs a RECEIVED signal for every active subscriber. Safe to call again: each
 * subscriber runs at most once per signal. If another signal of the same bot is
 * running, waits for it; if it can't get its turn, the signal stays RECEIVED and
 * the cron retry picks it up.
 */
export async function executeSignal(db: Db, hl: HlGateway, signalId: string) {
  const [first] = await db.select().from(botSignals).where(eq(botSignals.id, signalId)).limit(1);
  if (!first || first.status !== "RECEIVED") return first ?? null;
  const lockKey = `bot:${first.botId}:${first.network}`;
  const holder = crypto.randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (!(await acquireLock(db, lockKey, holder))) {
    if (Date.now() > deadline) return first;
    await new Promise((r) => setTimeout(r, 1000));
  }
  try {
    return await runSignal(db, hl, signalId);
  } finally {
    await releaseLock(db, lockKey, holder);
  }
}

async function runSignal(db: Db, hl: HlGateway, signalId: string) {
  const [signal] = await db.select().from(botSignals).where(eq(botSignals.id, signalId)).limit(1);
  // Someone else finished it while we waited for the lock.
  if (!signal || signal.status !== "RECEIVED") return signal ?? null;
  const finish = async (status: "PROCESSED" | "IGNORED" | "FAILED", summary: unknown, error: string | null = null) => {
    const [row] = await db
      .update(botSignals)
      .set({ status, summary: summary ?? null, error, processedAt: new Date() })
      .where(eq(botSignals.id, signal.id))
      .returning();
    return row;
  };
  try {
    const engine = engineAvailability();
    if (!engine.enabled) return finish("IGNORED", null, engine.reason);
    if (hl.network !== signal.network) return finish("IGNORED", null, "Signal is for another network.");
    const [bot] = await db.select().from(bots).where(eq(bots.id, signal.botId)).limit(1);
    if (!bot || bot.status !== "LIVE") return finish("IGNORED", null, "The bot isn't live, so no orders were placed.");
    const config = bot.config as BotConfig;
    if (!config.markets.includes(`${signal.coin}-PERP`)) {
      return finish("IGNORED", null, `${signal.coin}-PERP isn't one of this bot's markets (${config.markets.join(", ")}).`);
    }
    const target = applyDirection(signal.action as TargetAction, config.direction);
    const subs = await db
      .select()
      .from(botSubscriptions)
      .where(and(eq(botSubscriptions.botId, bot.id), eq(botSubscriptions.network, signal.network), eq(botSubscriptions.status, "ACTIVE")))
      .limit(MAX_SUBSCRIBERS_PER_SIGNAL);
    const counts = { subscribers: subs.length, done: 0, skipped: 0, failed: 0, target };
    for (const sub of subs) {
      const r = await runForSubscriber(db, hl, bot, config, signal, sub, target);
      if (r) counts[r.status === "DONE" ? "done" : r.status === "SKIPPED" ? "skipped" : "failed"]++;
    }
    return finish("PROCESSED", counts);
  } catch (err) {
    return finish("FAILED", null, message(err).slice(0, 500));
  }
}

/** Claims (signal, subscription) once, then acts. Returns null if another run already handled it. */
async function runForSubscriber(db: Db, hl: HlGateway, bot: Bot, config: BotConfig, signal: Signal, sub: Subscription, target: TargetAction) {
  const [claim] = await db
    .insert(botExecutions)
    .values({ signalId: signal.id, subscriptionId: sub.id, userId: sub.userId, status: "RUNNING" })
    .onConflictDoNothing()
    .returning();
  if (!claim) return null;
  let outcome: Outcome;
  try {
    outcome = isCopyBot(config) ? await copyToFollower(db, hl, bot, config, signal, sub) : await moveToTarget(db, hl, bot, config, signal.coin, sub, target, stageOf(signal.payload));
  } catch (err) {
    const reason = err instanceof ApiError ? `${err.code}: ${message(err)}` : message(err);
    outcome = { status: "FAILED", reason: reason.slice(0, 500), orderIds: [] };
  }
  await db.update(botExecutions).set({ status: outcome.status, reason: outcome.reason, orderIds: outcome.orderIds }).where(eq(botExecutions.id, claim.id));
  return outcome;
}

async function moveToTarget(
  db: Db,
  hl: HlGateway,
  bot: Bot,
  config: BotConfig,
  coin: string,
  sub: Subscription,
  target: TargetAction,
  stage: number | null,
): Promise<Outcome> {
  const [u] = await db.select().from(users).where(eq(users.id, sub.userId)).limit(1);
  if (!u) return { status: "FAILED", reason: "Subscriber not found.", orderIds: [] };
  // placeOrder only needs the identity; roles/session are irrelevant for bot orders.
  const user: SessionUser = { id: u.id, walletAddress: u.walletAddress as `0x${string}`, roles: [], sessionId: "bot-engine", chainId: 0 };
  const ctx = { source: "BOT" as const, botId: bot.id };
  // On mainnet the gate wants an explicit confirmation per order. For bot orders that is the
  // subscriber's consent plus the amount per trade they set themselves (checked below before opening).
  const mainnet = { confirmMainnet: hl.network === "mainnet" };
  const orderIds: string[] = [];

  const [tracked] = await db
    .select()
    .from(botPositions)
    .where(and(eq(botPositions.subscriptionId, sub.id), eq(botPositions.coin, coin)))
    .limit(1);
  const actual = await positionSize(hl, user.walletAddress, coin);
  let held: { side: "LONG" | "SHORT"; size: Decimal } | null = null;
  if (tracked) {
    const sign = tracked.side === "LONG" ? 1 : -1;
    // The stop may have fired or the user closed it: only what is still open on Hyperliquid counts.
    if (actual.mul(sign).gt(0)) held = { side: tracked.side as "LONG" | "SHORT", size: Decimal.min(new Decimal(tracked.size), actual.abs()) };
    if (!held) await db.delete(botPositions).where(eq(botPositions.id, tracked.id));
  }

  if (held && held.side === target) return { status: "SKIPPED", reason: `Already ${target.toLowerCase()} ${held.size} ${coin}.`, orderIds };
  if (!held && target === "FLAT") return { status: "SKIPPED", reason: "No bot position to close.", orderIds };

  // 1. Close the bot's opposite position. Only what actually closed counts: a partial
  // close keeps the rest tracked with its stop, and nothing new opens.
  let closedNote = "";
  let before = actual;
  if (held && tracked) {
    const close = await placeOrder(db, hl, user, { coin, isBuy: held.side === "SHORT", size: held.size.toString(), orderType: "MARKET", reduceOnly: true, ...mainnet }, ctx);
    orderIds.push(close.id);
    const closed = Decimal.min(await orderEffect(hl, user.walletAddress, coin, close, held.side, actual, true), held.size);
    const left = held.size.minus(closed);
    const status = `${close.status}${close.error ? `: ${close.error}` : ""}`;
    if (left.gt(0)) {
      await db.update(botPositions).set({ size: left.toString() }).where(eq(botPositions.id, tracked.id));
      const kept = tracked.stopCloid ? "its stop loss stays in place" : "it has no stop loss";
      return closed.isZero()
        ? { status: "FAILED", reason: `Close order ${status}; the ${held.side.toLowerCase()} ${held.size} ${coin} is still open and ${kept}.`, orderIds }
        : { status: "FAILED", reason: `Close order ${status}: closed ${closed} of ${held.size} ${coin}; ${left} ${coin} is still open and ${kept}.`, orderIds };
    }
    if (tracked.stopCloid) await cancelStop(db, hl, user, coin, tracked.stopCloid);
    await db.delete(botPositions).where(eq(botPositions.id, tracked.id));
    closedNote = `Closed ${held.side.toLowerCase()} ${closed} ${coin}. `;
    if (target === "FLAT") return { status: "DONE", reason: closedNote.trim(), orderIds };
    before = await positionSize(hl, user.walletAddress, coin);
  }

  // 2. Open the new position.
  if (!sub.orderUsd) return { status: "SKIPPED", reason: `${closedNote}No amount per trade is set for this subscription.`, orderIds };
  if (await hasUnprotectedPosition(db, sub.id)) {
    return { status: "SKIPPED", reason: `${closedNote}A bot position is open without a stop loss; no new positions until it is protected or closed.`, orderIds };
  }
  // Staged scenario: the subscription holds the strategy capital and the signal names the stage.
  let stageNote = "";
  let size = new Decimal(sub.orderUsd);
  if (config.scenario) {
    if (!stage || stage > config.scenario.stages.length) {
      return { status: "SKIPPED", reason: `${closedNote}The signal names no valid stage (1–${config.scenario.stages.length}), so the entry size is unknown.`, orderIds };
    }
    const pct = config.scenario.stages[stage - 1];
    size = stageNotionalUsd(sub.orderUsd, pct, config.risk.maxLeverage);
    stageNote = `Stage ${stage}/${config.scenario.stages.length} (${pct}% of ${sub.orderUsd} USDC capital at ${config.risk.maxLeverage}x): `;
  }
  const orderUsd = Decimal.min(size, config.risk.maxOrderUsd);
  const pnl = await realizedPnlToday(db, hl, user.walletAddress, sub.id);
  if (pnl.lte(-config.risk.dailyLossLimitUsd)) {
    await db.insert(riskEvents).values({ userId: user.id, botId: bot.id, kind: "DAILY_LOSS_LIMIT", severity: "WARN", detail: { pnl: pnl.toFixed(2), limit: config.risk.dailyLossLimitUsd } });
    return { status: "SKIPPED", reason: `${closedNote}Daily loss limit reached (${pnl.toFixed(2)} USDC today); no new positions until tomorrow (UTC).`, orderIds };
  }
  const asset = (await hl.perpAssets()).find((a) => a.name === coin);
  const mid = (await hl.mids())[coin];
  if (!asset || !mid) return { status: "FAILED", reason: `${closedNote}No market data for ${coin}.`, orderIds };
  const agent = await activeAgent(db, user.id, hl.network);
  if (agent) {
    // Best effort: the gate's notional limits bound the risk even if this fails.
    await hl
      .updateLeverage(decryptAgentKey(agent.encryptedKey, agent.agentAddress), asset.index, Math.min(config.risk.maxLeverage, asset.maxLeverage))
      .catch((err) => db.insert(riskEvents).values({ userId: user.id, botId: bot.id, kind: "LEVERAGE_UPDATE_FAILED", severity: "INFO", detail: { message: message(err) } }));
  }
  const side = target as "LONG" | "SHORT";
  const liquidation = await liquidationBeforeStop(hl, user.walletAddress, orderUsd, config.risk.stopLossPct, asset.maxLeverage);
  if (liquidation) {
    await db.insert(riskEvents).values({ userId: user.id, botId: bot.id, kind: "STOP_BEYOND_LIQUIDATION", severity: "WARN", detail: { coin, orderUsd: orderUsd.toString(), stopLossPct: config.risk.stopLossPct } });
    return { status: "SKIPPED", reason: `${closedNote}${liquidation}`, orderIds };
  }
  const open = await placeOrder(db, hl, user, { coin, isBuy: side === "LONG", size: orderUsd.div(mid).toString(), orderType: "MARKET", ...mainnet }, ctx);
  orderIds.push(open.id);
  // With no answer the order may still have filled: the position on Hyperliquid decides.
  const filled = await orderEffect(hl, user.walletAddress, coin, open, side, before, false);
  if (filled.lte(0)) return { status: "FAILED", reason: `${closedNote}Open order ${open.status}${open.error ? `: ${open.error}` : ""}`, orderIds };
  const entry = new Decimal(open.avgPrice ?? mid);
  const recovered = open.status === "FILLED" ? "" : ` (no order response; the fill was confirmed from the position on Hyperliquid)`;

  // 3. Protective stop on Hyperliquid. No stop → the position is closed (fail closed).
  const stop = await protect(db, hl, user, { botId: bot.id, coin, side, size: filled, entry, stopLossPct: config.risk.stopLossPct }, orderIds);
  if (!stop.ok) {
    // Whatever the safety close left open stays tracked, without a stop: the guard retries it and new entries wait.
    if (stop.remaining.gt(0)) {
      await db.insert(botPositions).values({ subscriptionId: sub.id, coin, side, size: stop.remaining.toString(), entryPrice: entry.toString(), stopCloid: null, openedAt: new Date() });
    }
    return { status: "FAILED", reason: `${closedNote}${stop.reason}`, orderIds };
  }

  await db.insert(botPositions).values({
    subscriptionId: sub.id,
    coin,
    side,
    size: filled.toString(),
    entryPrice: entry.toString(),
    stopCloid: stop.cloid,
    openedAt: new Date(),
  });
  return {
    status: "DONE",
    reason: `${closedNote}${stageNote}Opened ${side.toLowerCase()} ${filled} ${coin} at ${entry.toString()}${recovered}; stop loss at ${stop.trigger}.`,
    orderIds,
  };
}

/** Signals still RECEIVED after a while (e.g. the request ended before after() ran): run them again. */
export async function retryStaleSignals(db: Db, hl: HlGateway, olderThanMs = 2 * 60_000) {
  const stale = await db
    .select({ id: botSignals.id, createdAt: botSignals.createdAt })
    .from(botSignals)
    .where(and(eq(botSignals.status, "RECEIVED"), eq(botSignals.network, hl.network)))
    .limit(20);
  const due = stale.filter((s) => Date.now() - s.createdAt.getTime() > olderThanMs);
  for (const s of due) await executeSignal(db, hl, s.id);
  return due.length;
}

/** Recent signals of a bot with per-status execution counts (owner/admin view). */
export async function recentSignals(db: Db, botId: string, network: "testnet" | "mainnet", limit = 10) {
  return db
    .select()
    .from(botSignals)
    .where(and(eq(botSignals.botId, botId), eq(botSignals.network, network)))
    .orderBy(desc(botSignals.createdAt))
    .limit(limit);
}

/** A subscriber's own recent executions for a bot. */
export async function recentExecutions(db: Db, subscriptionId: string, limit = 10) {
  return db
    .select({ e: botExecutions, action: botSignals.action, coin: botSignals.coin, source: botSignals.source, payload: botSignals.payload })
    .from(botExecutions)
    .innerJoin(botSignals, eq(botSignals.id, botExecutions.signalId))
    .where(eq(botExecutions.subscriptionId, subscriptionId))
    .orderBy(desc(botExecutions.createdAt))
    .limit(limit);
}

