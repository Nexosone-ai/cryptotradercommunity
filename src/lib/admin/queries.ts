import { desc, eq, inArray, sql } from "drizzle-orm";
import { verifyAuditChain } from "../audit";
import { getConfig } from "../config";
import type { Db } from "../db/client";
import { adminAuditLogs, bots, feeEvents, ledgerEntries, payouts, riskEvents, users } from "../db/schema";
import type { HlGateway } from "../hyperliquid/gateway";
import { reconcile } from "../ledger/service";
import { parseUsdcE8 } from "../money";
import { bi } from "../i18n";

export async function feeEventsList(db: Db, status?: string[], limit = 200) {
  return db
    .select({ ev: feeEvents, botName: bots.name, trader: users.walletAddress })
    .from(feeEvents)
    .leftJoin(bots, eq(bots.id, feeEvents.botId))
    .innerJoin(users, eq(users.id, feeEvents.traderUserId))
    .where(status ? inArray(feeEvents.status, status) : undefined)
    .orderBy(desc(feeEvents.occurredAt))
    .limit(limit);
}

/** Outstanding payables per recipient (credit balances shown positive). */
export async function payablesByRecipient(db: Db) {
  const rows = await db
    .select({
      userId: ledgerEntries.accountUserId,
      account: ledgerEntries.account,
      wallet: users.walletAddress,
      owed: sql<string>`-sum(${ledgerEntries.amountE8})`,
    })
    .from(ledgerEntries)
    .innerJoin(users, eq(users.id, ledgerEntries.accountUserId))
    .where(inArray(ledgerEntries.account, ["BOT_OWNER_PAYABLE", "PARTNER_PAYABLE"]))
    .groupBy(ledgerEntries.accountUserId, ledgerEntries.account, users.walletAddress)
    .having(sql`sum(${ledgerEntries.amountE8}) <> 0`);
  return rows.map((r) => ({ ...r, owed: BigInt(r.owed) }));
}

export async function ledgerOverview(db: Db, hl: HlGateway) {
  const report = await reconcile(db);
  const builder = getConfig().builderAddress;
  let hlRewards: { builderRewards: string; unclaimedRewards: string; claimedRewards: string } | null = null;
  let hlError: string | null = null;
  if (builder) {
    try {
      hlRewards = await hl.builderRewards(builder);
    } catch {
      hlError = bi("Hyperliquid referral (builder) lookup failed", "Hyperliquid referral(builder) 조회 실패");
    }
  }
  const [observed] = await db
    .select({ total: sql<string>`coalesce(sum(${feeEvents.amountE8}), 0)`, n: sql<number>`count(*)` })
    .from(feeEvents)
    .where(eq(feeEvents.status, "OBSERVED"));
  const unclaimedOnHl = hlRewards ? parseUsdcE8(hlRewards.unclaimedRewards).amount : null;
  return {
    report,
    observedE8: BigInt(observed?.total ?? "0"),
    observedCount: Number(observed?.n ?? 0),
    hlRewards,
    hlError,
    /** Receivable on our books vs. unclaimed builder rewards Hyperliquid reports. */
    receivableVsHl: unclaimedOnHl === null ? null : { ledgerReceivableE8: report.receivableE8, hlUnclaimedE8: unclaimedOnHl },
  };
}

export async function payoutsList(db: Db) {
  return db
    .select({ p: payouts, wallet: users.walletAddress })
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.recipientUserId))
    .orderBy(desc(payouts.createdAt))
    .limit(200);
}

export async function auditLogs(db: Db, limit = 200) {
  const rows = await db.select().from(adminAuditLogs).orderBy(desc(adminAuditLogs.seq)).limit(limit);
  return { rows, brokenAt: await verifyAuditChain(db) };
}

export async function recentRiskEvents(db: Db, limit = 100) {
  return db.select().from(riskEvents).orderBy(desc(riskEvents.createdAt)).limit(limit);
}

export async function systemStatus(hl: HlGateway) {
  const cfg = getConfig();
  let hlOk = false;
  let hlLatencyMs: number | null = null;
  const t = Date.now();
  try {
    await hl.mids();
    hlOk = true;
    hlLatencyMs = Date.now() - t;
  } catch {
    hlOk = false;
  }
  return {
    network: cfg.network,
    mainnetTradingEnabled: cfg.mainnetTradingEnabled,
    builderConfigured: Boolean(cfg.builderAddress),
    builderAddress: cfg.builderAddress,
    agentKeysConfigured: cfg.agentKeyConfigured,
    database: cfg.databaseConfigured ? "postgres" : "pglite (dev only)",
    sessionSecretConfigured: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32),
    adminWalletConfigured: Boolean(cfg.adminWallet),
    platformMaxFeeTenthsBp: cfg.platformMaxFeeTenthsBp,
    manualOrderFeeTenthsBp: cfg.manualOrderFeeTenthsBp,
    hyperliquid: { ok: hlOk, latencyMs: hlLatencyMs },
    automaticPayouts: "disabled (manual approval only — Phase 2)",
    botRunner: "not deployed (Phase 2)",
  };
}
