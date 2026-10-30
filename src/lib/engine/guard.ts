import Decimal from "decimal.js";
import { and, count, desc, eq, gte, max, ne } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import type { BotConfig } from "../bots/schema";
import type { Db } from "../db/client";
import { botPositions, botSignals, botSubscriptions, bots, engineLocks, orders, riskEvents, tradingAccounts, users } from "../db/schema";
import type { HlGateway } from "../hyperliquid/gateway";
import { reconcileOrders } from "../trading/service";
import { cancelStop, positionSize, protect, sideSize } from "./common";
import { acquireLock, releaseLock } from "./execute";

/**
 * Position guard (docs/BOT_ENGINE.md §Safety). Every minute, for each position
 * the engine holds, checks Hyperliquid: what is still open, and whether its
 * stop loss is still resting. A missing stop (it failed earlier, or someone
 * canceled it) is placed again; if that fails the position is closed. Runs
 * under the bot's lock so it never races a signal on the same positions.
 */
export async function guardPositions(db: Db, hl: HlGateway) {
  const rows = await db
    .select({ p: botPositions, botId: botSubscriptions.botId, userId: botSubscriptions.userId, wallet: users.walletAddress, config: bots.config })
    .from(botPositions)
    .innerJoin(botSubscriptions, eq(botSubscriptions.id, botPositions.subscriptionId))
    .innerJoin(bots, eq(bots.id, botSubscriptions.botId))
    .innerJoin(users, eq(users.id, botSubscriptions.userId))
    .where(eq(botSubscriptions.network, hl.network));
  const byBot = new Map<string, typeof rows>();
  for (const r of rows) byBot.set(r.botId, [...(byBot.get(r.botId) ?? []), r]);

  const result = { checked: 0, closed: 0, reprotected: 0, unprotected: 0 };
  for (const [botId, list] of byBot) {
    const lockKey = `bot:${botId}:${hl.network}`;
    const holder = crypto.randomUUID();
    // A signal is running for this bot: it owns these positions right now; check next minute.
    if (!(await acquireLock(db, lockKey, holder))) continue;
    try {
      const resting = new Map<string, Set<string>>();
      for (const { p, userId, wallet, config } of list) {
        result.checked++;
        try {
          const side = p.side as "LONG" | "SHORT";
          const open = Decimal.min(sideSize(await positionSize(hl, wallet, p.coin), side), new Decimal(p.size));
          const user: SessionUser = { id: userId, walletAddress: wallet as `0x${string}`, roles: [], sessionId: "bot-engine", chainId: 0 };
          if (open.isZero()) {
            // Closed on Hyperliquid (stop fired, user closed it): stop tracking it.
            if (p.stopCloid) await cancelStop(db, hl, user, p.coin, p.stopCloid);
            await db.delete(botPositions).where(eq(botPositions.id, p.id));
            result.closed++;
            continue;
          }
          if (!open.eq(p.size)) await db.update(botPositions).set({ size: open.toString() }).where(eq(botPositions.id, p.id));
          if (p.stopCloid) {
            if (!resting.has(wallet)) resting.set(wallet, await restingCloids(hl, wallet));
            if (resting.get(wallet)!.has(p.stopCloid.toLowerCase())) continue;
          }
          const stop = await protect(
            db,
            hl,
            user,
            { botId, coin: p.coin, side, size: open, entry: new Decimal(p.entryPrice), stopLossPct: (config as BotConfig).risk.stopLossPct },
            [],
          );
          if (stop.ok) {
            await db.update(botPositions).set({ stopCloid: stop.cloid }).where(eq(botPositions.id, p.id));
            result.reprotected++;
          } else if (stop.remaining.isZero()) {
            await db.delete(botPositions).where(eq(botPositions.id, p.id));
            result.closed++;
          } else {
            await db.update(botPositions).set({ size: stop.remaining.toString(), stopCloid: null }).where(eq(botPositions.id, p.id));
            result.unprotected++;
          }
        } catch (err) {
          console.error("[engine] guard failed", p.id, err instanceof Error ? err.message : err);
        }
      }
    } finally {
      await releaseLock(db, lockKey, holder);
    }
  }
  return result;
}

async function restingCloids(hl: HlGateway, wallet: string): Promise<Set<string>> {
  const open = (await hl.openOrders(wallet)) as { cloid?: string | null }[];
  return new Set(open.map((o) => o.cloid?.toLowerCase()).filter((c): c is string => Boolean(c)));
}

/**
 * When the engine last ran (admin health panel). Kept as an engine_locks row whose
 * expiry is the time of the last tick; it is never taken as a lock.
 */
const heartbeatKey = (network: string) => `heartbeat:engine:${network}`;

export async function recordHeartbeat(db: Db, network: string) {
  const now = new Date();
  await db
    .insert(engineLocks)
    .values({ key: heartbeatKey(network), holder: "engine", expiresAt: now })
    .onConflictDoUpdate({ target: engineLocks.key, set: { expiresAt: now } });
}

export async function lastHeartbeat(db: Db, network: string): Promise<Date | null> {
  const [row] = await db.select().from(engineLocks).where(eq(engineLocks.key, heartbeatKey(network))).limit(1);
  return row?.expiresAt ?? null;
}

/** Safety work of one engine tick: settle orders left without an answer, then check every held position. */
export async function runSafetyTick(db: Db, hl: HlGateway) {
  const orders = await reconcileOrders(db, hl);
  const positions = await guardPositions(db, hl);
  return { orders, positions };
}

/** Admin health panel: is the engine running, and is anything unsafe right now? */
export async function engineHealth(db: Db, network: "testnet" | "mainnet") {
  const day = new Date(Date.now() - 86_400_000);
  const [heartbeat, lastSignal, orderCounts, positions, lastSync, critical] = await Promise.all([
    lastHeartbeat(db, network),
    db
      .select({ createdAt: botSignals.createdAt, status: botSignals.status, action: botSignals.action, coin: botSignals.coin, source: botSignals.source, botName: bots.name })
      .from(botSignals)
      .innerJoin(bots, eq(bots.id, botSignals.botId))
      .where(and(eq(botSignals.network, network), ne(botSignals.status, "IGNORED")))
      .orderBy(desc(botSignals.createdAt))
      .limit(1),
    db
      .select({ status: orders.status, n: count() })
      .from(orders)
      .where(and(eq(orders.network, network), eq(orders.source, "BOT"), gte(orders.createdAt, day)))
      .groupBy(orders.status),
    db
      .select({ stopCloid: botPositions.stopCloid })
      .from(botPositions)
      .innerJoin(botSubscriptions, eq(botSubscriptions.id, botPositions.subscriptionId))
      .where(eq(botSubscriptions.network, network)),
    db.select({ at: max(tradingAccounts.lastFillSyncAt) }).from(tradingAccounts).where(eq(tradingAccounts.network, network)),
    db
      .select({ n: count() })
      .from(riskEvents)
      .where(and(eq(riskEvents.severity, "CRITICAL"), gte(riskEvents.createdAt, day))),
  ]);
  const byStatus = Object.fromEntries(orderCounts.map((r) => [r.status, Number(r.n)]));
  const minutesAgo = (d: Date | null | undefined) => (d ? Math.floor((Date.now() - d.getTime()) / 60_000) : null);
  return {
    network,
    lastEngineRunAt: heartbeat?.toISOString() ?? null,
    lastEngineRunMinutesAgo: minutesAgo(heartbeat),
    lastSignal: lastSignal[0] ? { ...lastSignal[0], createdAt: lastSignal[0].createdAt.toISOString() } : null,
    botOrders24h: {
      filled: byStatus.FILLED ?? 0,
      resting: byStatus.RESTING ?? 0,
      rejected: byStatus.REJECTED ?? 0,
      error: byStatus.ERROR ?? 0,
      unknown: (byStatus.UNKNOWN ?? 0) + (byStatus.PENDING ?? 0),
      canceled: byStatus.CANCELED ?? 0,
    },
    openBotPositions: positions.length,
    positionsWithoutStop: positions.filter((p) => !p.stopCloid).length,
    lastSettlementSyncAt: lastSync[0]?.at?.toISOString() ?? null,
    lastSettlementSyncMinutesAgo: minutesAgo(lastSync[0]?.at),
    criticalEvents24h: Number(critical[0]?.n ?? 0),
  };
}
