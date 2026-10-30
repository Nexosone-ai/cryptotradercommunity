import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { feeEvents, ledgerEntries, orders, partners, riskEvents } from "@/lib/db/schema";
import { createBot, ownerSetStatus, reviewBot, submitBot, subscribe, unsubscribe, updateBot } from "@/lib/bots/service";
import { activatePartner, joinAsAffiliate, registerReferral, setWholesalerPortion } from "@/lib/referral/service";
import { placeOrder, prepareAgent, verifyAgent } from "@/lib/trading/service";
import { ingestFills } from "@/lib/settlement/ingest";
import {
  approvePayout,
  confirmAndAllocate,
  createPayout,
  createPolicyVersion,
  markPayoutPaid,
  payableBalance,
  reconcile,
  recordBuilderClaim,
} from "@/lib/ledger/service";
import { formatUsdcE8, parseUsdcE8 } from "@/lib/money";
import { verifyAuditChain } from "@/lib/audit";
import type { HlFill } from "@/lib/hyperliquid/gateway";
import { fakeHl } from "../helpers/fake-hl";
import { makeUser, testDb, validBotInput, type TestUser } from "../helpers/db";

const BUILDER = "0x1111111111111111111111111111111111111111";
const ENV_KEYS = ["BUILDER_ADDRESS", "AGENT_KEY_ENCRYPTION_KEY", "HL_NETWORK", "MAINNET_TRADING_ENABLED", "MANUAL_ORDER_BUILDER_FEE_TENTHS_BP"];
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.BUILDER_ADDRESS = BUILDER;
  process.env.AGENT_KEY_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.HL_NETWORK = "testnet";
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function liveBot(db: Db, fee = 20) {
  const owner = await makeUser(db);
  const admin = await makeUser(db, ["TRADER", "ADMIN"]);
  const input = validBotInput({ feeTenthsBp: fee });
  const { bot } = await createBot(db, owner, input);
  await submitBot(db, owner, bot.id);
  await reviewBot(db, admin, bot.id, "APPROVE");
  await ownerSetStatus(db, owner, bot.id, "LIVE");
  return { owner, admin, bot, input };
}

async function authorizedTrader(db: Db, hl: ReturnType<typeof fakeHl>, approvedFee: number) {
  const trader = await makeUser(db);
  const prepared = await prepareAgent(db, trader);
  hl.addAgent(trader.walletAddress, prepared.agentAddress);
  await verifyAgent(db, hl, trader);
  hl.setApproval(trader.walletAddress, approvedFee);
  return trader;
}

const btcBuy = { coin: "BTC", isBuy: true, size: "0.002", orderType: "MARKET" as const };

describe("server-side order gate", () => {
  let db: Db;
  let hl: ReturnType<typeof fakeHl>;
  beforeEach(async () => {
    db = await testDb();
    hl = fakeHl();
  });

  it("places a bot order with the subscriber's accepted fee and a unique cloid", async () => {
    const { bot } = await liveBot(db, 20);
    const trader = await authorizedTrader(db, hl, 50);
    await subscribe(db, trader, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true });
    const order = await placeOrder(db, hl, trader, btcBuy, { source: "BOT", botId: bot.id });
    expect(order.status).toBe("RESTING");
    expect(order.cloid).toMatch(/^0x[0-9a-f]{32}$/);
    expect(hl.calls[0].builder).toEqual({ b: BUILDER, f: 20 });
    expect(hl.calls[0].orders[0]).toMatchObject({ a: 0, b: true, s: "0.002", t: { limit: { tif: "Ioc" } } });
    expect(hl.calls[0].orders[0].p).toBe("84000");
  });

  it("refuses orders without a builder fee approval or above the approved max", async () => {
    const { bot } = await liveBot(db, 20);
    const trader = await authorizedTrader(db, hl, 0);
    await subscribe(db, trader, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true });
    await expect(placeOrder(db, hl, trader, btcBuy, { source: "BOT", botId: bot.id })).rejects.toMatchObject({ code: "BUILDER_FEE_NOT_APPROVED" });
    hl.setApproval(trader.walletAddress, 10);
    await expect(placeOrder(db, hl, trader, btcBuy, { source: "BOT", botId: bot.id })).rejects.toMatchObject({ code: "BUILDER_FEE_NOT_APPROVED" });
    expect(hl.calls).toHaveLength(0);
    const events = await db.select().from(riskEvents);
    expect(events.some((e) => e.kind === "ORDER_REJECTED:BUILDER_FEE_NOT_APPROVED")).toBe(true);
  });

  it("fails closed when Hyperliquid cannot confirm the approval", async () => {
    hl = fakeHl({ maxBuilderFee: async () => { throw new Error("timeout"); } });
    const { bot } = await liveBot(db, 20);
    const trader = await authorizedTrader(db, hl, 50);
    await subscribe(db, trader, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true });
    await expect(placeOrder(db, hl, trader, btcBuy, { source: "BOT", botId: bot.id })).rejects.toMatchObject({ code: "HL_UNAVAILABLE" });
  });

  it("a fee increase does not reach the subscriber's orders without re-consent", async () => {
    const { bot, owner, input } = await liveBot(db, 20);
    const trader = await authorizedTrader(db, hl, 100);
    await subscribe(db, trader, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true });
    await updateBot(db, owner, bot.id, { ...input, feeTenthsBp: 40 });
    await expect(placeOrder(db, hl, trader, btcBuy, { source: "BOT", botId: bot.id })).rejects.toMatchObject({ code: "SUBSCRIPTION_INACTIVE" });
    expect(hl.calls).toHaveLength(0);
  });

  it("blocks new bot orders immediately after the user stops the bot", async () => {
    const { bot } = await liveBot(db, 20);
    const trader = await authorizedTrader(db, hl, 50);
    await subscribe(db, trader, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true });
    await placeOrder(db, hl, trader, btcBuy, { source: "BOT", botId: bot.id });
    await unsubscribe(db, trader, bot.id);
    await expect(placeOrder(db, hl, trader, btcBuy, { source: "BOT", botId: bot.id })).rejects.toMatchObject({ code: "SUBSCRIPTION_INACTIVE" });
    expect(hl.calls).toHaveLength(1);
  });

  it("blocks bot orders when the owner pauses the bot", async () => {
    const { bot, owner } = await liveBot(db, 20);
    const trader = await authorizedTrader(db, hl, 50);
    await subscribe(db, trader, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true });
    await ownerSetStatus(db, owner, bot.id, "PAUSED");
    await expect(placeOrder(db, hl, trader, btcBuy, { source: "BOT", botId: bot.id })).rejects.toMatchObject({ code: "BOT_NOT_LIVE" });
  });

  it("requires an active agent, and enforces size, market and mainnet rules", async () => {
    const noAgent = await makeUser(db);
    await expect(placeOrder(db, hl, noAgent, btcBuy, { source: "MANUAL" })).rejects.toMatchObject({ code: "AGENT_NOT_AUTHORIZED" });

    const trader = await authorizedTrader(db, hl, 0);
    await expect(placeOrder(db, hl, trader, { ...btcBuy, size: "1" }, { source: "MANUAL" })).rejects.toMatchObject({ code: "ORDER_TOO_LARGE" });
    await expect(placeOrder(db, hl, trader, { ...btcBuy, coin: "NOPE" }, { source: "MANUAL" })).rejects.toMatchObject({ code: "UNKNOWN_MARKET" });
    await expect(
      placeOrder(db, hl, trader, { ...btcBuy, orderType: "LIMIT", price: "120000" }, { source: "MANUAL" }),
    ).rejects.toMatchObject({ code: "PRICE_OUT_OF_BAND" });
    // Manual order with no builder fee configured carries no builder param.
    const ok = await placeOrder(db, hl, trader, btcBuy, { source: "MANUAL" });
    expect(ok.status).toBe("RESTING");
    expect(hl.calls.at(-1)?.builder).toBeUndefined();

    process.env.HL_NETWORK = "mainnet";
    try {
      const mainnetHl = fakeHl();
      (mainnetHl as { network: string }).network = "mainnet";
      await expect(placeOrder(db, mainnetHl, trader, btcBuy, { source: "MANUAL" })).rejects.toMatchObject({ code: "MAINNET_DISABLED" });
      process.env.MAINNET_TRADING_ENABLED = "true";
      await expect(placeOrder(db, mainnetHl, trader, btcBuy, { source: "MANUAL" })).rejects.toMatchObject({ code: "MAINNET_CONFIRM_REQUIRED" });
      expect(mainnetHl.calls).toHaveLength(0);
    } finally {
      process.env.HL_NETWORK = "testnet";
      delete process.env.MAINNET_TRADING_ENABLED;
    }
  });

  it("view-only mainnet refuses to hand out trading permission", async () => {
    const trader = await makeUser(db);
    process.env.HL_NETWORK = "mainnet";
    try {
      await expect(prepareAgent(db, trader)).rejects.toMatchObject({ code: "MAINNET_DISABLED" });
      process.env.MAINNET_TRADING_ENABLED = "true";
      await expect(prepareAgent(db, trader)).resolves.toMatchObject({ network: "mainnet", hyperliquidChain: "Mainnet" });
    } finally {
      process.env.HL_NETWORK = "testnet";
      delete process.env.MAINNET_TRADING_ENABLED;
    }
  });

  it("agent verification requires Hyperliquid to report the agent", async () => {
    const trader = await makeUser(db);
    await prepareAgent(db, trader);
    await expect(verifyAgent(db, hl, trader)).rejects.toMatchObject({ code: "AGENT_NOT_APPROVED" });
  });
});

describe("fee ledger and settlement", () => {
  let db: Db;
  let hl: ReturnType<typeof fakeHl>;
  let A: TestUser, B: TestUser, C: TestUser;
  beforeEach(async () => {
    db = await testDb();
    hl = fakeHl();
    A = await makeUser(db);
    B = await makeUser(db);
    // A: wholesale partner keeping 10 points; B: A's affiliate; C: B's client.
    await activatePartner(db, A.id, A.walletAddress);
    const pa = await setWholesalerPortion(db, A, 100_000, 210_000);
    const pb = await joinAsAffiliate(db, B, pa.affiliateInviteCode!);
    C = await makeUser(db);
    await registerReferral(db, C.id, pb.referralCode);
  });

  async function filledBotOrder(trader: TestUser, builderFee = "100") {
    const { bot, owner, admin } = await liveBot(db, 20);
    const prepared = await prepareAgent(db, trader);
    hl.addAgent(trader.walletAddress, prepared.agentAddress);
    await verifyAgent(db, hl, trader);
    hl.setApproval(trader.walletAddress, 20);
    await subscribe(db, trader, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true });
    const order = await placeOrder(db, hl, trader, btcBuy, { source: "BOT", botId: bot.id });
    const fill: HlFill = {
      coin: "BTC", px: "80010", sz: "0.002", side: "B", time: Date.now(), closedPnl: "0", hash: `0x${"ab".repeat(32)}`,
      oid: order.hlOrderId!, crossed: true, fee: "0.072", builderFee, tid: 777001, feeToken: "USDC", cloid: order.cloid,
    };
    return { bot, owner, admin, order, fill };
  }

  it("affiliate's client: one fill of 100 USDC builder fee allocates 70 / 9 / 11 (affiliate B) / 10 (wholesaler A)", async () => {
    const { owner, admin, fill } = await filledBotOrder(C);
    const r = await ingestFills(db, "testnet", C.walletAddress, [fill]);
    expect(r).toMatchObject({ matched: 1, newFills: 1, newFeeEvents: 1 });
    const [ev] = await db.select().from(feeEvents);
    expect(ev).toMatchObject({ status: "OBSERVED", tier1PartnerUserId: B.id, tier2PartnerUserId: A.id, wholesalerPortionPpm: 100_000 });

    // Nothing is payable before revenue is confirmed.
    expect(await payableBalance(db, owner.id, "BOT_OWNER_PAYABLE")).toBe(0n);
    await confirmAndAllocate(db, admin, [ev.id], "matched HL referral.builderRewards");

    expect(formatUsdcE8(await payableBalance(db, owner.id, "BOT_OWNER_PAYABLE"))).toBe("70.00");
    expect(formatUsdcE8(await payableBalance(db, B.id, "PARTNER_PAYABLE"))).toBe("11.00");
    expect(formatUsdcE8(await payableBalance(db, A.id, "PARTNER_PAYABLE"))).toBe("10.00");
    const rep = await reconcile(db);
    expect(rep.issues).toEqual([]);
    expect(formatUsdcE8(rep.platformNetE8)).toBe("9.00");
    expect(rep.unallocatedReserveE8).toBe(0n);
    expect(formatUsdcE8(rep.allocatedRevenueE8)).toBe("100.00");
  });

  it("the same fill delivered many times is recorded and allocated once", async () => {
    const { admin, fill } = await filledBotOrder(C, "1.23456789");
    for (let i = 0; i < 5; i++) await ingestFills(db, "testnet", C.walletAddress, [fill, fill]);
    const evs = await db.select().from(feeEvents);
    expect(evs).toHaveLength(1);
    await confirmAndAllocate(db, admin, [evs[0].id, evs[0].id], "dup test");
    await confirmAndAllocate(db, admin, [evs[0].id], "dup test again");
    const journals = await db.execute(sql`select count(distinct journal_id) as n from ledger_entries`);
    const rows = (Array.isArray(journals) ? journals : (journals as { rows: { n: number }[] }).rows) as { n: number }[];
    expect(Number(rows[0].n)).toBe(1);
    expect((await reconcile(db)).issues).toEqual([]);
  });

  it("the wholesaler's own client gives them the whole 21%", async () => {
    const pa = (await db.select().from(partners).where(eq(partners.userId, A.id)))[0];
    const direct = await makeUser(db);
    await registerReferral(db, direct.id, pa.referralCode);
    const { admin, fill } = await filledBotOrder(direct);
    await ingestFills(db, "testnet", direct.walletAddress, [fill]);
    const [ev] = await db.select().from(feeEvents);
    expect(ev).toMatchObject({ tier1PartnerUserId: null, tier2PartnerUserId: A.id });
    await confirmAndAllocate(db, admin, [ev.id], "ok");
    expect(formatUsdcE8(await payableBalance(db, A.id, "PARTNER_PAYABLE"))).toBe("21.00");
    expect((await reconcile(db)).issues).toEqual([]);
  });

  it("no referrer → the whole 30% goes to the platform", async () => {
    const lone = await makeUser(db);
    const { admin, fill } = await filledBotOrder(lone);
    await ingestFills(db, "testnet", lone.walletAddress, [fill]);
    const [ev] = await db.select().from(feeEvents);
    await confirmAndAllocate(db, admin, [ev.id], "ok");
    const rep = await reconcile(db);
    expect(rep.unallocatedReserveE8).toBe(0n);
    expect(formatUsdcE8(rep.platformNetE8)).toBe("30.00");
    expect(rep.issues).toEqual([]);
  });

  it("fills of orders not placed through the platform are ignored", async () => {
    const { fill } = await filledBotOrder(C);
    const r = await ingestFills(db, "testnet", C.walletAddress, [{ ...fill, oid: 999999, cloid: null, tid: 1 }]);
    expect(r).toMatchObject({ matched: 0, newFeeEvents: 0 });
  });

  it("partial fills create one event each; canceled remainder adds nothing", async () => {
    const { admin, fill } = await filledBotOrder(C, "0.6");
    await ingestFills(db, "testnet", C.walletAddress, [
      { ...fill, tid: 1, sz: "0.001", builderFee: "0.3" },
      { ...fill, tid: 2, sz: "0.001", builderFee: "0.3" },
    ]);
    const evs = await db.select().from(feeEvents);
    expect(evs.map((e) => e.amountE8).sort()).toEqual([parseUsdcE8("0.3").amount, parseUsdcE8("0.3").amount]);
    await confirmAndAllocate(db, admin, evs.map((e) => e.id), "partial");
    const rep = await reconcile(db);
    expect(formatUsdcE8(rep.allocatedRevenueE8)).toBe("0.60");
    expect(rep.issues).toEqual([]);
  });

  it("past fills keep the policy version in force at fill time", async () => {
    const { admin, fill } = await filledBotOrder(C);
    await ingestFills(db, "testnet", C.walletAddress, [fill]);
    await createPolicyVersion(db, admin, {
      botOwnerSharePpm: 500_000, platformShareOfPoolPpm: 500_000, tier1ShareOfPartnerPoolPpm: 500_000,
      effectiveFrom: new Date(Date.now() + 3_600_000), note: "future change",
    });
    await expect(
      createPolicyVersion(db, admin, {
        botOwnerSharePpm: 1, platformShareOfPoolPpm: 1, tier1ShareOfPartnerPoolPpm: 1, effectiveFrom: new Date(Date.now() - 86_400_000),
      }),
    ).rejects.toMatchObject({ code: "RETROACTIVE_POLICY" });
    const [ev] = await db.select().from(feeEvents);
    await confirmAndAllocate(db, admin, [ev.id], "ok");
    expect(formatUsdcE8((await reconcile(db)).platformNetE8)).toBe("9.00");
  });

  it("ledger entries are append-only and journals must balance", async () => {
    const { admin, fill } = await filledBotOrder(C);
    await ingestFills(db, "testnet", C.walletAddress, [fill]);
    const [ev] = await db.select().from(feeEvents);
    await confirmAndAllocate(db, admin, [ev.id], "ok");
    await expect(db.update(ledgerEntries).set({ amountE8: 0n })).rejects.toThrow();
    await expect(db.delete(ledgerEntries)).rejects.toThrow();
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(ledgerEntries).values({ journalId: "bad", account: "PLATFORM_NET_REVENUE", amountE8: -5n });
      }),
    ).rejects.toThrow();
    expect(await verifyAuditChain(db)).toBeNull();
  });

  it("payouts: claim → create → approve → paid keeps the ledger reconciled", async () => {
    const { owner, admin, fill } = await filledBotOrder(C);
    await ingestFills(db, "testnet", C.walletAddress, [fill]);
    const [ev] = await db.select().from(feeEvents);
    await confirmAndAllocate(db, admin, [ev.id], "ok");

    const payout = await createPayout(db, admin, { recipientUserId: owner.id, account: "BOT_OWNER_PAYABLE" });
    expect(formatUsdcE8(payout.amountE8)).toBe("70.00");
    await expect(createPayout(db, admin, { recipientUserId: owner.id, account: "BOT_OWNER_PAYABLE" })).rejects.toMatchObject({ code: "BELOW_MINIMUM" });
    await expect(markPayoutPaid(db, admin, payout.id, `0x${"1".repeat(64)}`)).rejects.toMatchObject({ code: "PAYOUT_NOT_APPROVED" });
    await approvePayout(db, admin, payout.id);
    await expect(markPayoutPaid(db, admin, payout.id, `0x${"1".repeat(64)}`)).rejects.toMatchObject({ code: "INSUFFICIENT_CLAIMED_FUNDS" });
    await recordBuilderClaim(db, admin, parseUsdcE8("100").amount, "claim-1");
    await markPayoutPaid(db, admin, payout.id, `0x${"1".repeat(64)}`);
    await expect(markPayoutPaid(db, admin, payout.id, `0x${"1".repeat(64)}`)).rejects.toMatchObject({ code: "PAYOUT_NOT_APPROVED" });

    expect(await payableBalance(db, owner.id, "BOT_OWNER_PAYABLE")).toBe(0n);
    const rep = await reconcile(db);
    expect(rep.issues).toEqual([]);
    expect(formatUsdcE8(rep.paidOutE8)).toBe("70.00");
    expect(formatUsdcE8(rep.platformHlBalanceE8)).toBe("30.00");
  });

  it("orders table stores the cloid ↔ bot mapping", async () => {
    const { bot, order } = await filledBotOrder(C);
    const [row] = await db.select().from(orders).where(eq(orders.cloid, order.cloid));
    expect(row.botId).toBe(bot.id);
    expect(row.source).toBe("BOT");
  });
});
