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
import type { HlFill, HlOrderWire } from "@/lib/hyperliquid/gateway";
import { prepareAgent, verifyAgent } from "@/lib/trading/service";
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
  const hl = fakeHl({
    placeOrders: async (agentKey, list: HlOrderWire[]) =>
      list.map((o) => {
        hl.calls.push({ orders: [o], agentKey });
        if ("trigger" in o.t) return opts.failStops ? { error: "Stop rejected" } : { resting: { oid: 7000 + hl.calls.length } };
        const coin = o.a === 0 ? "BTC" : "ETH";
        const wallet = walletFor(agentKey);
        const book = positions.get(wallet) ?? new Map<string, Decimal>();
        positions.set(wallet, book);
        book.set(coin, (book.get(coin) ?? new Decimal(0)).plus(o.b ? o.s : new Decimal(o.s).neg()));
        return { filled: { oid: 5000 + hl.calls.length, totalSz: o.s, avgPx: coin === "BTC" ? "80000" : "2400" } };
      }),
    cancelByCloid: async (_k, _a, cloid) => {
      canceled.push(cloid);
    },
    updateLeverage: async (_k, _a, lev) => {
      leverage.push(lev);
    },
    clearinghouseState: async (user: string) => {
      const book = positions.get(user.toLowerCase());
      return {
        marginSummary: { accountValue: "1000" },
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
  return { hl, positions, fills, canceled, leverage };
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
});
