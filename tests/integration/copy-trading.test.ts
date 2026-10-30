import { randomBytes } from "node:crypto";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { botExecutions, botPositions, botSignals, bots, orders } from "@/lib/db/schema";
import { createBot, ownerSetStatus, reviewBot, submitBot, subscribe } from "@/lib/bots/service";
import { runCopyTick } from "@/lib/engine/copy";
import { subscriberReadiness } from "@/lib/engine/readiness";
import type { HlOrderWire } from "@/lib/hyperliquid/gateway";
import { prepareAgent, verifyAgent } from "@/lib/trading/service";
import { fakeHl } from "../helpers/fake-hl";
import { makeUser, testDb, validBotInput, type TestUser } from "../helpers/db";

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

/** Fake Hyperliquid: IOC orders fill at mid (BTC 80,000), stops rest; the leader's account is set directly. */
function exchange() {
  const positions = new Map<string, Map<string, Decimal>>(); // follower wallet → coin → signed size
  const leader = { wallet: "", value: "10000", positions: new Map<string, { szi: string; leverage: number }>() };
  const canceled: string[] = [];
  const leverage: number[] = [];
  const walletOfAgent = new Map<string, string>();
  const walletFor = (agentKey: string) => walletOfAgent.get(privateKeyToAccount(agentKey as `0x${string}`).address.toLowerCase())!;
  const hl = fakeHl({
    placeOrders: async (agentKey, list: HlOrderWire[]) =>
      list.map((o) => {
        hl.calls.push({ orders: [o], agentKey });
        if ("trigger" in o.t) return { resting: { oid: 7000 + hl.calls.length } };
        const wallet = walletFor(agentKey);
        const book = positions.get(wallet) ?? new Map<string, Decimal>();
        positions.set(wallet, book);
        book.set("BTC", (book.get("BTC") ?? new Decimal(0)).plus(o.b ? o.s : new Decimal(o.s).neg()));
        return { filled: { oid: 5000 + hl.calls.length, totalSz: o.s, avgPx: "80000" } };
      }),
    cancelByCloid: async (_k, _a, cloid) => {
      canceled.push(cloid);
    },
    updateLeverage: async (_k, _a, lev) => {
      leverage.push(lev);
    },
    clearinghouseState: async (user: string) => {
      if (user.toLowerCase() === leader.wallet) {
        return {
          marginSummary: { accountValue: leader.value },
          withdrawable: leader.value,
          assetPositions: [...leader.positions.entries()].map(([coin, p]) => ({ position: { coin, szi: p.szi, leverage: { type: "cross", value: p.leverage } } })),
        };
      }
      const book = positions.get(user.toLowerCase());
      return {
        marginSummary: { accountValue: "2000" },
        assetPositions: [...(book?.entries() ?? [])].filter(([, s]) => !s.isZero()).map(([coin, s]) => ({ position: { coin, szi: s.toString() } })),
      };
    },
  });
  const addAgent = hl.addAgent;
  hl.addAgent = (user, address) => {
    walletOfAgent.set(address.toLowerCase(), user.toLowerCase());
    addAgent(user, address);
  };
  const setLeader = (szi: string, lev = 5) => {
    if (szi === "0") leader.positions.delete("BTC");
    else leader.positions.set("BTC", { szi, leverage: lev });
  };
  return { hl, positions, leader, setLeader, canceled, leverage };
}

type Ex = ReturnType<typeof exchange>;

const copyInput = (overrides: Record<string, unknown> = {}) =>
  validBotInput({
    strategyType: "COPY_TRADING",
    executionMode: "COPY_TRADE",
    markets: ["BTC-PERP"],
    leverageMax: 10,
    risk: { maxOrderUsd: 5000, maxPositionUsd: 10000, maxLeverage: 10, stopLossPct: 5, dailyLossLimitUsd: 500, emergencyStop: true },
    ...overrides,
  });

async function copyBot(db: Db, ex: Ex) {
  const leader = await makeUser(db);
  const admin = await makeUser(db, ["TRADER", "ADMIN"]);
  const { bot } = await createBot(db, leader, copyInput());
  await submitBot(db, leader, bot.id);
  await reviewBot(db, admin, bot.id, "APPROVE");
  await ownerSetStatus(db, leader, bot.id, "LIVE");
  ex.leader.wallet = leader.walletAddress.toLowerCase();
  return { leader, bot };
}

async function follower(db: Db, ex: Ex, botId: string, allocation = 1000): Promise<{ trader: TestUser; subId: string }> {
  const trader = await makeUser(db);
  const prepared = await prepareAgent(db, trader);
  ex.hl.addAgent(trader.walletAddress, prepared.agentAddress);
  await verifyAgent(db, ex.hl, trader);
  ex.hl.setApproval(trader.walletAddress, 20);
  const sub = await subscribe(db, trader, botId, { acceptedFeeTenthsBp: 20, acceptRisk: true, orderUsd: allocation });
  return { trader, subId: sub.id };
}

const copySignals = (db: Db, botId: string) => db.select().from(botSignals).where(and(eq(botSignals.botId, botId), eq(botSignals.source, "COPY")));
const lastExecution = async (db: Db, subId: string) => {
  const rows = await db.select().from(botExecutions).where(eq(botExecutions.subscriptionId, subId));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1);
};

describe("copy trading", () => {
  let db: Db;
  let ex: Ex;
  beforeEach(async () => {
    db = await testDb();
    ex = exchange();
  });

  it("mirrors the leader's open, add and close proportionally, with a stop loss and the bot's fee", async () => {
    const { bot } = await copyBot(db, ex);
    const { trader, subId } = await follower(db, ex, bot.id, 1000); // 10% of the leader's 10,000

    // First look: only a baseline, nothing is traded.
    await runCopyTick(db, ex.hl);
    expect(await copySignals(db, bot.id)).toMatchObject([{ status: "IGNORED", dedupeKey: "copy:BTC:baseline" }]);
    expect(ex.hl.calls).toHaveLength(0);

    // Leader opens 0.5 BTC long at 5x → follower buys 0.05 BTC at 5x with a stop 5% below entry.
    ex.setLeader("0.5", 5);
    expect(await runCopyTick(db, ex.hl)).toEqual([{ botId: bot.id, coin: "BTC", action: "LONG" }]);
    expect(ex.leverage).toEqual([5]);
    const [open, stop] = ex.hl.calls.map((c) => c.orders[0]);
    expect(open).toMatchObject({ b: true, s: "0.05", r: false });
    expect(stop).toMatchObject({ b: false, s: "0.05", r: true, t: { trigger: { triggerPx: "76000", tpsl: "sl" } } });
    let [pos] = await db.select().from(botPositions).where(eq(botPositions.subscriptionId, subId));
    expect(pos).toMatchObject({ side: "LONG", size: "0.05" });

    // No change → no signal, no orders.
    await runCopyTick(db, ex.hl);
    expect(ex.hl.calls).toHaveLength(2);

    // Leader adds to 1 BTC → follower adds 0.05; a new stop for 0.1 replaces the old one.
    ex.setLeader("1", 5);
    await runCopyTick(db, ex.hl);
    const [add, stop2] = ex.hl.calls.slice(2).map((c) => c.orders[0]);
    expect(add).toMatchObject({ b: true, s: "0.05", r: false });
    expect(stop2).toMatchObject({ b: false, s: "0.1", r: true });
    expect(ex.canceled).toEqual([pos.stopCloid]);
    [pos] = await db.select().from(botPositions).where(eq(botPositions.subscriptionId, subId));
    expect(pos).toMatchObject({ size: "0.1", entryPrice: "80000" });

    // Leader closes → follower closes everything and the stop is canceled.
    ex.setLeader("0");
    await runCopyTick(db, ex.hl);
    const close = ex.hl.calls.at(-1)!.orders[0];
    expect(close).toMatchObject({ b: false, s: "0.1", r: true });
    expect(ex.canceled).toContain(pos.stopCloid);
    expect(await db.select().from(botPositions).where(eq(botPositions.subscriptionId, subId))).toHaveLength(0);
    expect(ex.positions.get(trader.walletAddress.toLowerCase())?.get("BTC")?.toString()).toBe("0");

    const copied = await db.select().from(orders).where(eq(orders.subscriptionId, subId));
    expect(copied.every((o) => o.source === "BOT" && o.builderFeeTenthsBp === 20)).toBe(true);
    expect((await lastExecution(db, subId))?.status).toBe("DONE");
  });

  it("doesn't copy positions the leader held before the market was watched or before the follower joined", async () => {
    const { bot } = await copyBot(db, ex);
    ex.setLeader("0.5");
    const early = await follower(db, ex, bot.id);
    await runCopyTick(db, ex.hl); // baseline at 0.5
    ex.setLeader("0.8");
    await runCopyTick(db, ex.hl);
    expect(ex.hl.calls).toHaveLength(0);
    expect((await lastExecution(db, early.subId))?.reason).toMatch(/next new position/);

    // A new position after that is copied.
    ex.setLeader("0");
    await runCopyTick(db, ex.hl);
    ex.setLeader("-0.5", 3);
    await runCopyTick(db, ex.hl);
    expect(ex.hl.calls[0].orders[0]).toMatchObject({ b: false, s: "0.05", r: false });
    expect(ex.leverage).toEqual([3]);
  });

  it("validates the allocation and the copy-trading configuration; readiness speaks of the allocation", async () => {
    const { bot } = await copyBot(db, ex);
    const trader = await makeUser(db);
    await expect(subscribe(db, trader, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true, orderUsd: 10 })).rejects.toMatchObject({ code: "ALLOCATION_INVALID" });
    // Above a normal bot's max order is fine: the allocation isn't an order size.
    const sub = await subscribe(db, trader, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true, orderUsd: 20_000 });
    const [liveRow] = await db.select().from(bots).where(eq(bots.id, bot.id));
    const items = await subscriberReadiness(db, ex.hl, trader, liveRow, sub);
    expect(items.find((i) => i.key === "bot")).toMatchObject({ ok: true, label: "Lead trader is live and being copied" });
    expect(items.find((i) => i.key === "amount")).toMatchObject({ ok: true, label: "Copy allocation: 20000 USDC" });
    expect(items.find((i) => i.key === "funds")).toMatchObject({ ok: false });

    const leader = await makeUser(db);
    await expect(createBot(db, leader, copyInput({ strategyType: "TREND_FOLLOWING" }))).rejects.toThrow();
    await expect(createBot(db, leader, validBotInput({ strategyType: "COPY_TRADING" }))).rejects.toThrow();
  });
});
