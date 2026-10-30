import { randomBytes } from "node:crypto";
import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { botExecutions, botPositions, botSignals, orders, riskEvents } from "@/lib/db/schema";
import { createBot, ownerSetStatus, reviewBot, submitBot, subscribe } from "@/lib/bots/service";
import { executeSignal, retryStaleSignals } from "@/lib/engine/execute";
import { rotateWebhookToken, setOrderUsd } from "@/lib/engine/manage";
import { recordSignal, webhookTokenMatches, type TargetAction } from "@/lib/engine/signals";
import { runTrendTick } from "@/lib/engine/trend";
import { subscriberReadiness } from "@/lib/engine/readiness";
import type { HlFill, HlOrderWire } from "@/lib/hyperliquid/gateway";
import { orderLookup, prepareAgent, reconcileOrders, verifyAgent } from "@/lib/trading/service";
import { HlRejectedError } from "@/lib/hyperliquid/errors";
import { guardPositions } from "@/lib/engine/guard";
import { fakeHl } from "../helpers/fake-hl";
import { makeUser, testDb, validBotInput } from "../helpers/db";

const BUILDER = "0x1111111111111111111111111111111111111111";
const ENV_KEYS = ["BUILDER_ADDRESS", "AGENT_KEY_ENCRYPTION_KEY", "HL_NETWORK", "BOT_ENGINE_ENABLED", "MAINNET_TRADING_ENABLED"];
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.BUILDER_ADDRESS = BUILDER;
  process.env.AGENT_KEY_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.HL_NETWORK = "testnet";
  process.env.BOT_ENGINE_ENABLED = "true";
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Fake Hyperliquid that fills IOC orders at mid, rests stops and keeps per-user positions. */
function exchange(opts: { failStops?: boolean } = {}) {
  const positions = new Map<string, Map<string, Decimal>>(); // wallet → coin → signed size
  const fills: HlFill[] = [];
  const canceled: string[] = [];
  const leverage: number[] = [];
  const walletOfAgent = new Map<string, string>(); // agent address → user wallet
  const walletFor = (agentKey: string) => walletOfAgent.get(privateKeyToAccount(agentKey as `0x${string}`).address.toLowerCase())!;
  /** Orders Hyperliquid "knows" (info orderStatus), by cloid. */
  const known = new Map<string, { status: string; oid: number; origSz: string; sz: string }>();
  /** Knobs for failure tests; each can change between signals. */
  const knobs = {
    failStops: Boolean(opts.failStops),
    /** Reduce-only market orders are refused (the safety close fails). */
    failCloses: false,
    /** Share of a market order that fills (IOC: the rest is canceled). */
    fillRatio: 1,
    /** The order executes but its response never arrives. */
    dropResponse: false,
    /** orderStatus doesn't know the order (yet). */
    hideFromLookup: false,
    accountValue: "1000",
  };
  const hl = fakeHl({
    placeOrders: async (agentKey, list: HlOrderWire[]) => {
      const statuses = list.map((o) => {
        hl.calls.push({ orders: [o], agentKey });
        const oid = 5000 + hl.calls.length;
        if ("trigger" in o.t) {
          if (knobs.failStops) return { error: "Stop rejected" };
          known.set(o.c, { status: "open", oid, origSz: o.s, sz: o.s });
          return { resting: { oid } };
        }
        if (o.r && knobs.failCloses) return { error: "Reduce only order would increase position" };
        const coin = o.a === 0 ? "BTC" : "ETH";
        const wallet = walletFor(agentKey);
        const book = positions.get(wallet) ?? new Map<string, Decimal>();
        positions.set(wallet, book);
        const sz = new Decimal(o.s).mul(knobs.fillRatio).toDecimalPlaces(5, Decimal.ROUND_DOWN);
        book.set(coin, (book.get(coin) ?? new Decimal(0)).plus(o.b ? sz : sz.neg()));
        if (!knobs.hideFromLookup) known.set(o.c, { status: sz.eq(o.s) ? "filled" : "canceled", oid, origSz: o.s, sz: new Decimal(o.s).minus(sz).toString() });
        return { filled: { oid, totalSz: sz.toString(), avgPx: coin === "BTC" ? "80000" : "2400" } };
      });
      if (knobs.dropResponse) throw new Error("fetch failed: socket hang up");
      return statuses;
    },
    orderStatus: async (_user, cloid) => known.get(cloid) ?? null,
    openOrders: async () => [...known.entries()].filter(([, o]) => o.status === "open").map(([cloid]) => ({ cloid })),
    cancelByCloid: async (_k, _a, cloid) => {
      canceled.push(cloid);
      known.delete(cloid);
    },
    updateLeverage: async (_k, _a, lev) => {
      leverage.push(lev);
    },
    clearinghouseState: async (user: string) => {
      const book = positions.get(user.toLowerCase());
      return {
        marginSummary: { accountValue: knobs.accountValue },
        crossMaintenanceMarginUsed: "0",
        assetPositions: [...(book?.entries() ?? [])].filter(([, s]) => !s.isZero()).map(([coin, s]) => ({ position: { coin, szi: s.toString() } })),
      };
    },
    userFillsByTime: async () => fills,
  });
  const addAgent = hl.addAgent;
  hl.addAgent = (user, address) => {
    walletOfAgent.set(address.toLowerCase(), user.toLowerCase());
    addAgent(user, address);
  };
  return { hl, positions, fills, canceled, leverage, known, knobs };
}

type Ex = ReturnType<typeof exchange>;

async function liveBot(db: Db, overrides: Record<string, unknown> = {}) {
  const owner = await makeUser(db);
  const admin = await makeUser(db, ["TRADER", "ADMIN"]);
  const { bot } = await createBot(db, owner, validBotInput({ executionMode: "WEBHOOK_SIGNAL", markets: ["BTC-PERP"], ...overrides }));
  await submitBot(db, owner, bot.id);
  await reviewBot(db, admin, bot.id, "APPROVE");
  await ownerSetStatus(db, owner, bot.id, "LIVE");
  return { owner, bot };
}

async function subscriber(db: Db, ex: Ex, botId: string, orderUsd: number | null = 100, approvedFee = 20) {
  const trader = await makeUser(db);
  const prepared = await prepareAgent(db, trader);
  ex.hl.addAgent(trader.walletAddress, prepared.agentAddress);
  await verifyAgent(db, ex.hl, trader);
  ex.hl.setApproval(trader.walletAddress, approvedFee);
  const sub = await subscribe(db, trader, botId, { acceptedFeeTenthsBp: 20, acceptRisk: true, ...(orderUsd ? { orderUsd } : {}) });
  return { trader, sub };
}

let seq = 0;
async function signal(db: Db, ex: Ex, botId: string, action: TargetAction, coin = "BTC") {
  const s = await recordSignal(db, { botId, network: "testnet", source: "WEBHOOK", action, coin, dedupeKey: `t${seq++}` });
  return (await executeSignal(db, ex.hl, s!.id))!;
}

async function executionsFor(db: Db, subscriptionId: string) {
  return db.select().from(botExecutions).where(eq(botExecutions.subscriptionId, subscriptionId));
}

describe("bot execution engine", () => {
  let db: Db;
  let ex: Ex;
  beforeEach(async () => {
    db = await testDb();
    ex = exchange();
  });


  it("LONG opens a position of the subscriber's amount with a stop loss; repeating LONG does nothing", async () => {
    const { bot } = await liveBot(db);
    const { sub } = await subscriber(db, ex, bot.id, 100);
    const s = await signal(db, ex, bot.id, "LONG");
    expect(s.status).toBe("PROCESSED");
    expect(s.summary).toMatchObject({ subscribers: 1, done: 1, skipped: 0, failed: 0 });
    // Market buy 100 USDC / 80000 = 0.00125 BTC, then a reduce-only stop 5% below entry.
    const [open, stop] = ex.hl.calls.map((c) => c.orders[0]);
    expect(open).toMatchObject({ a: 0, b: true, s: "0.00125", r: false });
    expect(stop).toMatchObject({ b: false, s: "0.00125", r: true, t: { trigger: { isMarket: true, triggerPx: "76000", tpsl: "sl" } } });
    expect(ex.leverage).toEqual([5]);
    const [pos] = await db.select().from(botPositions).where(eq(botPositions.subscriptionId, sub.id));
    expect(pos).toMatchObject({ side: "LONG", size: "0.00125", entryPrice: "80000" });
    const botOrders = await db.select().from(orders).where(eq(orders.subscriptionId, sub.id));
    expect(botOrders.every((o) => o.source === "BOT" && o.builderFeeTenthsBp === 20)).toBe(true);

    const again = await signal(db, ex, bot.id, "LONG");
    expect(again.summary).toMatchObject({ skipped: 1 });
    expect(ex.hl.calls).toHaveLength(2);
  });

  it("SHORT closes the long, cancels its stop and opens a short; FLAT closes it", async () => {
    const { bot } = await liveBot(db);
    const { sub } = await subscriber(db, ex, bot.id, 100);
    await signal(db, ex, bot.id, "LONG");
    const stopCloid = (await db.select().from(botPositions).where(eq(botPositions.subscriptionId, sub.id)))[0].stopCloid;

    await signal(db, ex, bot.id, "SHORT");
    const calls = ex.hl.calls.map((c) => c.orders[0]);
    expect(calls[2]).toMatchObject({ b: false, s: "0.00125", r: true }); // close long
    expect(ex.canceled).toContain(stopCloid);
    expect(calls[3]).toMatchObject({ b: false, s: "0.00125", r: false }); // open short
    expect(calls[4]).toMatchObject({ b: true, r: true, t: { trigger: { triggerPx: "84000" } } });
    expect((await db.select().from(botPositions).where(eq(botPositions.subscriptionId, sub.id)))[0].side).toBe("SHORT");

    const flat = await signal(db, ex, bot.id, "FLAT");
    expect(flat.summary).toMatchObject({ done: 1 });
    expect(ex.hl.calls.at(-1)!.orders[0]).toMatchObject({ b: true, s: "0.00125", r: true });
    expect(await db.select().from(botPositions).where(eq(botPositions.subscriptionId, sub.id))).toHaveLength(0);
  });

  it("a long-only bot treats SHORT as close", async () => {
    const { bot } = await liveBot(db, { direction: "LONG" });
    await subscriber(db, ex, bot.id, 100);
    await signal(db, ex, bot.id, "LONG");
    const s = await signal(db, ex, bot.id, "SHORT");
    expect(s.summary).toMatchObject({ target: "FLAT", done: 1 });
    expect(ex.hl.calls).toHaveLength(3); // open, stop, close — no short
  });

  it("skips subscribers without an amount, fails without trading permission, and records why", async () => {
    const { bot } = await liveBot(db);
    const { sub: noAmount } = await subscriber(db, ex, bot.id, null);
    const noAgent = await makeUser(db);
    const subNoAgent = await subscribe(db, noAgent, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true, orderUsd: 50 });
    const s = await signal(db, ex, bot.id, "LONG");
    expect(s.summary).toMatchObject({ subscribers: 2, done: 0, skipped: 1, failed: 1 });
    expect((await executionsFor(db, noAmount.id))[0]).toMatchObject({ status: "SKIPPED", reason: expect.stringContaining("amount per trade") });
    expect((await executionsFor(db, subNoAgent.id))[0]).toMatchObject({ status: "FAILED", reason: expect.stringContaining("AGENT_NOT_AUTHORIZED") });
    expect(ex.hl.calls).toHaveLength(0);
  });

  it("closes the new position when the stop loss can't be placed", async () => {
    ex = exchange({ failStops: true });
    const { bot } = await liveBot(db);
    const { sub } = await subscriber(db, ex, bot.id, 100);
    const s = await signal(db, ex, bot.id, "LONG");
    expect(s.summary).toMatchObject({ failed: 1 });
    const calls = ex.hl.calls.map((c) => c.orders[0]);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatchObject({ b: false, s: "0.00125", r: true });
    expect(await db.select().from(botPositions).where(eq(botPositions.subscriptionId, sub.id))).toHaveLength(0);
    expect((await db.select().from(riskEvents).where(eq(riskEvents.kind, "STOP_LOSS_FAILED"))).length).toBe(1);
  });

  it("stops opening new positions once today's losses reach the daily limit", async () => {
    const { bot } = await liveBot(db); // dailyLossLimitUsd 200
    const { sub } = await subscriber(db, ex, bot.id, 100);
    await signal(db, ex, bot.id, "LONG");
    const [o] = await db.select().from(orders).where(eq(orders.subscriptionId, sub.id)).limit(1);
    ex.fills.push({ coin: "BTC", px: "70000", sz: "0.00125", side: "A", time: Date.now(), closedPnl: "-195", hash: "0x", oid: 1, crossed: true, fee: "6", tid: 1, feeToken: "USDC", cloid: o.cloid });
    const s = await signal(db, ex, bot.id, "SHORT");
    expect((await executionsFor(db, sub.id)).find((e) => e.signalId === s.id)).toMatchObject({ status: "SKIPPED", reason: expect.stringContaining("Daily loss limit") });
  });

  it("ignores signals when the engine is off, the bot is paused or the coin isn't one of its markets", async () => {
    const { owner, bot } = await liveBot(db);
    await subscriber(db, ex, bot.id, 100);
    expect((await signal(db, ex, bot.id, "LONG", "ETH")).status).toBe("IGNORED");
    process.env.BOT_ENGINE_ENABLED = "false";
    try {
      expect((await signal(db, ex, bot.id, "LONG")).error).toMatch(/turned off/);
    } finally {
      process.env.BOT_ENGINE_ENABLED = "true";
    }
    await ownerSetStatus(db, owner, bot.id, "PAUSED");
    expect((await signal(db, ex, bot.id, "LONG")).error).toMatch(/isn't live/);
    expect(ex.hl.calls).toHaveLength(0);
  });

  it("deduplicates signals and runs each subscriber at most once per signal", async () => {
    const { bot } = await liveBot(db);
    await subscriber(db, ex, bot.id, 100);
    const s = await recordSignal(db, { botId: bot.id, network: "testnet", source: "WEBHOOK", action: "LONG", coin: "BTC", dedupeKey: "same" });
    expect(await recordSignal(db, { botId: bot.id, network: "testnet", source: "WEBHOOK", action: "LONG", coin: "BTC", dedupeKey: "same" })).toBeNull();
    await Promise.all([executeSignal(db, ex.hl, s!.id), executeSignal(db, ex.hl, s!.id)]);
    expect(ex.hl.calls).toHaveLength(2); // one open + one stop
    const [row] = await db.select().from(botSignals).where(eq(botSignals.id, s!.id));
    expect(row.status).toBe("PROCESSED");
    expect(await retryStaleSignals(db, ex.hl, 0)).toBe(0);
  });

  it("webhook tokens: owner-only, stored hashed, rotation invalidates the old token", async () => {
    const { owner, bot } = await liveBot(db);
    const other = await makeUser(db);
    await expect(rotateWebhookToken(db, other, bot.id)).rejects.toMatchObject({ status: 403 });
    const t1 = await rotateWebhookToken(db, owner, bot.id);
    const t2 = await rotateWebhookToken(db, owner, bot.id);
    const { bots } = await import("@/lib/db/schema");
    const [row] = await db.select().from(bots).where(eq(bots.id, bot.id));
    expect(row.webhookSecretHash).not.toContain(t2);
    expect(webhookTokenMatches(t2, row.webhookSecretHash)).toBe(true);
    expect(webhookTokenMatches(t1, row.webhookSecretHash)).toBe(false);
    const template = await liveBot(db, { executionMode: "PLATFORM_TEMPLATE" });
    await expect(rotateWebhookToken(db, template.owner, template.bot.id)).rejects.toMatchObject({ code: "NOT_WEBHOOK_BOT" });
  });

  it("amount per trade is validated against the bot's max order", async () => {
    const { bot } = await liveBot(db); // maxOrderUsd 500
    const { trader } = await subscriber(db, ex, bot.id, 100);
    await expect(setOrderUsd(db, trader, bot.id, "testnet", 501)).rejects.toMatchObject({ code: "ORDER_USD_TOO_LARGE" });
    await expect(setOrderUsd(db, trader, bot.id, "testnet", 5)).rejects.toMatchObject({ code: "ORDER_USD_TOO_SMALL" });
    expect((await setOrderUsd(db, trader, bot.id, "testnet", 250)).orderUsd).toBe(250);
  });

  it("the Trend Following template emits one signal per crossover candle", async () => {
    const { bot } = await liveBot(db, { executionMode: "PLATFORM_TEMPLATE", strategyType: "TREND_FOLLOWING", timeframe: "1h" });
    await subscriber(db, ex, bot.id, 100);
    const now = Date.UTC(2026, 9, 29, 12, 30);
    const hour = 3_600_000;
    // 40 falling closes, then a sharp rise on the last closed candle → EMA9 crosses above EMA21.
    const closes = [...Array.from({ length: 40 }, (_, i) => 90_000 - i * 100), 95_000];
    const start = Math.floor(now / hour) * hour - closes.length * hour;
    ex.hl.candles = async () => closes.map((c, i) => ({ t: start + i * hour, T: start + (i + 1) * hour - 1, c: String(c) }));
    const first = await runTrendTick(db, ex.hl, now);
    expect(first).toEqual([{ botId: bot.id, coin: "BTC", action: "LONG" }]);
    expect(await runTrendTick(db, ex.hl, now)).toEqual([]);
    const [s] = await db.select().from(botSignals).where(eq(botSignals.botId, bot.id));
    expect(s).toMatchObject({ source: "TEMPLATE", action: "LONG", status: "PROCESSED" });
  });

  it("on mainnet, bots trade only when both MAINNET_TRADING_ENABLED and BOT_ENGINE_ENABLED are on", async () => {
    const { bot } = await liveBot(db);
    // Subscriptions and agents are per network, so set them up on mainnet.
    process.env.HL_NETWORK = "mainnet";
    try {
      ex.hl.network = "mainnet";
      process.env.MAINNET_TRADING_ENABLED = "true"; // needed to grant the agent
      const { sub } = await subscriber(db, ex, bot.id, 100);
      const run = async () => {
        const s = await recordSignal(db, { botId: bot.id, network: "mainnet", source: "WEBHOOK", action: "LONG", coin: "BTC", dedupeKey: `m${seq++}` });
        return (await executeSignal(db, ex.hl, s!.id))!;
      };
      delete process.env.MAINNET_TRADING_ENABLED;
      expect((await run()).error).toMatch(/Mainnet trading isn.t enabled/);
      process.env.MAINNET_TRADING_ENABLED = "true";
      process.env.BOT_ENGINE_ENABLED = "false";
      expect((await run()).error).toMatch(/turned off/);
      expect(ex.hl.calls).toHaveLength(0);
      process.env.BOT_ENGINE_ENABLED = "true";
      const s = await run();
      expect(s.summary).toMatchObject({ done: 1 });
      expect(ex.hl.calls.map((c) => c.orders[0].r)).toEqual([false, true]); // open + stop, accepted by the mainnet gate
      expect((await db.select().from(botPositions).where(eq(botPositions.subscriptionId, sub.id)))[0].side).toBe("LONG");
    } finally {
      process.env.HL_NETWORK = "testnet";
      process.env.BOT_ENGINE_ENABLED = "true";
      delete process.env.MAINNET_TRADING_ENABLED;
    }
  });

  it("readiness counts a Unified account's spot USDC as its trading balance", async () => {
    const { bot } = await liveBot(db);
    const { trader, sub } = await subscriber(db, ex, bot.id, 100);
    ex.hl.accountMode = async () => "unifiedAccount";
    ex.hl.spotBalances = async () => [{ coin: "USDC", total: "48.75", hold: "0" }];
    ex.hl.clearinghouseState = async () => ({ marginSummary: { accountValue: "0.0" }, withdrawable: "0.0", assetPositions: [] });
    const { bots } = await import("@/lib/db/schema");
    const [row] = await db.select().from(bots).where(eq(bots.id, bot.id));
    const items = await subscriberReadiness(db, ex.hl, trader, row, sub);
    expect(items.find((i) => i.key === "funds")).toMatchObject({ ok: true, label: "Hyperliquid account value: 48.75 USDC" });
  });
});

describe("order safety: lost responses, partial closes, failed stops", () => {
  let db: Db;
  let ex: Ex;
  beforeAll(() => {
    orderLookup.delaysMs = [0];
  });
  beforeEach(async () => {
    db = await testDb();
    ex = exchange();
  });
  const positionsOf = (subId: string) => db.select().from(botPositions).where(eq(botPositions.subscriptionId, subId));
  const ordersOf = (subId: string) => db.select().from(orders).where(eq(orders.subscriptionId, subId)).orderBy(orders.createdAt);
  const eventsOf = (kind: string) => db.select().from(riskEvents).where(eq(riskEvents.kind, kind));

  it("a lost response is looked up by cloid: the fill counts and the stop is still placed", async () => {
    const { bot } = await liveBot(db);
    const { sub } = await subscriber(db, ex, bot.id, 100);
    ex.knobs.dropResponse = true;
    const s = await signal(db, ex, bot.id, "LONG");
    expect(s.summary).toMatchObject({ done: 1, failed: 0 });
    const [open, stop] = await ordersOf(sub.id);
    expect(open).toMatchObject({ status: "FILLED", filledSize: "0.00125" });
    expect(stop).toMatchObject({ status: "RESTING", orderType: "STOP_MARKET" });
    const [pos] = await positionsOf(sub.id);
    expect(pos).toMatchObject({ side: "LONG", size: "0.00125", stopCloid: stop.cloid });
    expect(await eventsOf("ORDER_RESPONSE_LOST")).toHaveLength(2);
  });

  it("an order Hyperliquid can't find yet stays UNKNOWN; the engine reads the position, protects it, and the cron settles the order", async () => {
    const { bot } = await liveBot(db);
    const { sub } = await subscriber(db, ex, bot.id, 100);
    ex.knobs.dropResponse = true;
    ex.knobs.hideFromLookup = true;
    await signal(db, ex, bot.id, "LONG");
    const [exec] = await executionsFor(db, sub.id);
    expect(exec).toMatchObject({ status: "DONE", reason: expect.stringContaining("confirmed from the position on Hyperliquid") });
    const [open] = await ordersOf(sub.id);
    expect(open.status).toBe("UNKNOWN");
    const [unknown] = await eventsOf("ORDER_RESULT_UNKNOWN");
    expect(unknown.severity).toBe("CRITICAL");
    expect((await positionsOf(sub.id))[0]).toMatchObject({ size: "0.00125", stopCloid: expect.any(String) });

    ex.known.set(open.cloid, { status: "filled", oid: 99, origSz: "0.00125", sz: "0" });
    expect(await reconcileOrders(db, ex.hl, 0)).toBe(1);
    expect((await ordersOf(sub.id))[0]).toMatchObject({ status: "FILLED", filledSize: "0.00125", hlOrderId: 99 });
  });

  it("a refusal from Hyperliquid is REJECTED, not unknown", async () => {
    const { bot } = await liveBot(db);
    const { sub } = await subscriber(db, ex, bot.id, 100);
    ex.hl.placeOrders = async () => {
      throw new HlRejectedError("Insufficient margin to place order.");
    };
    const s = await signal(db, ex, bot.id, "LONG");
    expect(s.summary).toMatchObject({ failed: 1 });
    expect((await ordersOf(sub.id))[0]).toMatchObject({ status: "REJECTED", error: expect.stringContaining("Insufficient margin") });
    expect(await eventsOf("ORDER_RESULT_UNKNOWN")).toHaveLength(0);
    expect(await positionsOf(sub.id)).toHaveLength(0);
  });

  it("a partial close keeps the rest tracked with its stop and opens nothing new", async () => {
    const { bot } = await liveBot(db);
    const { sub } = await subscriber(db, ex, bot.id, 100);
    await signal(db, ex, bot.id, "LONG");
    const { stopCloid } = (await positionsOf(sub.id))[0];
    ex.knobs.fillRatio = 0.4;
    const s = await signal(db, ex, bot.id, "SHORT");
    expect(s.summary).toMatchObject({ failed: 1 });
    expect((await executionsFor(db, sub.id)).find((e) => e.status === "FAILED")!.reason).toContain("closed 0.0005 of 0.00125 BTC; 0.00075 BTC is still open and its stop loss stays in place");
    expect((await positionsOf(sub.id))[0]).toMatchObject({ side: "LONG", size: "0.00075", stopCloid });
    expect(ex.canceled).not.toContain(stopCloid);
    expect(ex.hl.calls).toHaveLength(3); // open, stop, partial close — no short
  });

  it("if the stop and the safety close both fail: tracked without a stop, critical event, new entries wait, the guard protects it", async () => {
    const { bot } = await liveBot(db, { markets: ["BTC-PERP", "ETH-PERP"] });
    const { sub } = await subscriber(db, ex, bot.id, 100);
    ex.knobs.failStops = true;
    ex.knobs.failCloses = true;
    await signal(db, ex, bot.id, "LONG");
    expect((await executionsFor(db, sub.id))[0].reason).toContain("0.00125 BTC is still open without a stop");
    expect((await positionsOf(sub.id))[0]).toMatchObject({ coin: "BTC", size: "0.00125", stopCloid: null });
    expect((await eventsOf("UNPROTECTED_POSITION"))[0].severity).toBe("CRITICAL");

    // Another market's entry waits while BTC is unprotected.
    ex.knobs.failStops = false;
    ex.knobs.failCloses = false;
    const eth = await signal(db, ex, bot.id, "LONG", "ETH");
    expect(eth.summary).toMatchObject({ skipped: 1 });
    expect((await executionsFor(db, sub.id)).find((e) => e.status === "SKIPPED")!.reason).toContain("without a stop loss");

    expect(await guardPositions(db, ex.hl)).toMatchObject({ checked: 1, reprotected: 1 });
    expect((await positionsOf(sub.id))[0].stopCloid).toEqual(expect.any(String));
  });

  it("the guard re-places a stop that disappeared and stops tracking a position closed on Hyperliquid", async () => {
    const { bot } = await liveBot(db);
    const { trader, sub } = await subscriber(db, ex, bot.id, 100);
    await signal(db, ex, bot.id, "LONG");
    const { stopCloid } = (await positionsOf(sub.id))[0];
    expect(await guardPositions(db, ex.hl)).toMatchObject({ checked: 1, reprotected: 0 });

    ex.known.delete(stopCloid!); // canceled on Hyperliquid
    expect(await guardPositions(db, ex.hl)).toMatchObject({ reprotected: 1 });
    const [pos] = await positionsOf(sub.id);
    expect(pos.stopCloid).not.toBe(stopCloid);
    expect(ex.hl.calls.at(-1)!.orders[0]).toMatchObject({ b: false, s: "0.00125", r: true, t: { trigger: { triggerPx: "76000" } } });

    ex.positions.get(trader.walletAddress.toLowerCase())!.set("BTC", new Decimal(0)); // the stop fired
    expect(await guardPositions(db, ex.hl)).toMatchObject({ closed: 1 });
    expect(await positionsOf(sub.id)).toHaveLength(0);
  });

  it("skips an entry when the account would be liquidated before the stop loss", async () => {
    const { bot } = await liveBot(db);
    const { sub } = await subscriber(db, ex, bot.id, 100);
    ex.knobs.accountValue = "6"; // a 5% stop on 100 USDC loses 5; 1 USDC left is under the maintenance margin buffer
    const s = await signal(db, ex, bot.id, "LONG");
    expect(s.summary).toMatchObject({ skipped: 1 });
    expect((await executionsFor(db, sub.id))[0].reason).toContain("liquidated before the stop triggers");
    expect(ex.hl.calls).toHaveLength(0);
    expect(await eventsOf("STOP_BEYOND_LIQUIDATION")).toHaveLength(1);
  });
});

describe("staged scenario (webhook bots whose script names the stage)", () => {
  let db: Db;
  let ex: Ex;
  beforeEach(async () => {
    db = await testDb();
    ex = exchange();
  });
  const scenario = { stages: [10, 10, 10, 20, 20, 20], entry: "Long BTC at the next hourly candle.", takeProfit: "Cycle net PnL reaches 20% of margin used.", afterLastStage: "Pause after the sixth stop loss for review." };
  const stagedBot = () =>
    liveBot(db, {
      direction: "LONG",
      leverageMax: 5,
      risk: { ...validBotInput().risk, maxLeverage: 5, stopLossPct: 4, maxOrderUsd: 1000, maxPositionUsd: 1000 },
      scenario,
    });
  const staged = async (botId: string, action: TargetAction, stage?: number) => {
    const s = await recordSignal(db, { botId, network: "testnet", source: "WEBHOOK", action, coin: "BTC", dedupeKey: `st${seq++}`, payload: { stage: stage ?? null } });
    return (await executeSignal(db, ex.hl, s!.id))!;
  };

  it("sizes each entry from the subscriber's capital and the signal's stage; the stop is −20% of margin", async () => {
    const { bot } = await stagedBot();
    const { trader, sub } = await subscriber(db, ex, bot.id, 1000); // strategy capital
    expect((await staged(bot.id, "LONG", 1)).summary).toMatchObject({ done: 1 });
    // Stage 1: 10% of 1000 = 100 margin × 5x = 500 USDC → 0.00625 BTC; stop 4% below entry.
    const [open, stop] = ex.hl.calls.map((c) => c.orders[0]);
    expect(open).toMatchObject({ b: true, s: "0.00625", r: false });
    expect(stop).toMatchObject({ s: "0.00625", r: true, t: { trigger: { triggerPx: "76800" } } });
    expect((await executionsFor(db, sub.id))[0].reason).toContain("Stage 1/6 (10% of 1000 USDC capital at 5x)");

    // The stop fires; the script enters stage 4 (20%): 1000 USDC → 0.0125 BTC.
    ex.positions.get(trader.walletAddress.toLowerCase())!.set("BTC", new Decimal(0));
    expect((await staged(bot.id, "LONG", 4)).summary).toMatchObject({ done: 1 });
    expect(ex.hl.calls.at(-2)!.orders[0]).toMatchObject({ b: true, s: "0.0125", r: false });

    // Take profit: close needs no stage.
    expect((await staged(bot.id, "FLAT")).summary).toMatchObject({ done: 1 });
    expect(await db.select().from(botPositions).where(eq(botPositions.subscriptionId, sub.id))).toHaveLength(0);
  });

  it("an entry without a valid stage opens nothing; capital must keep every stage within limits", async () => {
    const { bot } = await stagedBot();
    const { trader, sub } = await subscriber(db, ex, bot.id, 1000);
    expect((await staged(bot.id, "LONG")).summary).toMatchObject({ skipped: 1 });
    expect((await executionsFor(db, sub.id))[0].reason).toContain("no valid stage");
    expect((await staged(bot.id, "LONG", 7)).summary).toMatchObject({ skipped: 1 });
    expect(ex.hl.calls).toHaveLength(0);
    await expect(setOrderUsd(db, trader, bot.id, "testnet", 21)).rejects.toMatchObject({ code: "CAPITAL_OUT_OF_RANGE" });
    await expect(setOrderUsd(db, trader, bot.id, "testnet", 1001)).rejects.toMatchObject({ code: "CAPITAL_OUT_OF_RANGE" });
    expect((await setOrderUsd(db, trader, bot.id, "testnet", 22)).orderUsd).toBe(22);
  });
});
