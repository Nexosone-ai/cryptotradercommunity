import { and, eq, inArray, or } from "drizzle-orm";
import { getConfig } from "../config";
import type { Db } from "../db/client";
import { feeEvents, fills, orders, tradingAccounts } from "../db/schema";
import type { HlFill, HlGateway } from "../hyperliquid/gateway";
import { getPolicyAt } from "../ledger/service";
import { parseUsdcE8 } from "../money";
import { resolveBeneficiaries } from "../referral/service";

const OVERLAP_MS = 60 * 60 * 1000;
const INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface IngestResult {
  fetched: number;
  matched: number;
  newFills: number;
  newFeeEvents: number;
}

/**
 * Stores fills that belong to platform orders and records one OBSERVED fee
 * event per fill with a builder fee. Unique keys (network, tid, oid) and the
 * fee event idempotency key make re-delivery of the same fill a no-op.
 */
export async function ingestFills(db: Db, network: "testnet" | "mainnet", hlAddress: string, rows: HlFill[]): Promise<IngestResult> {
  const builder = getConfig().builderAddress?.toLowerCase() ?? "";
  const result: IngestResult = { fetched: rows.length, matched: 0, newFills: 0, newFeeEvents: 0 };
  if (rows.length === 0) return result;

  const cloids = rows.map((r) => r.cloid).filter((c): c is string => Boolean(c));
  const oids = rows.map((r) => r.oid);
  const ours = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.network, network),
        eq(orders.hlAddress, hlAddress.toLowerCase()),
        cloids.length ? or(inArray(orders.cloid, cloids), inArray(orders.hlOrderId, oids)) : inArray(orders.hlOrderId, oids),
      ),
    );
  const byOid = new Map(ours.filter((o) => o.hlOrderId != null).map((o) => [o.hlOrderId!, o]));
  const byCloid = new Map(ours.map((o) => [o.cloid, o]));

  for (const f of rows) {
    const order = (f.cloid && byCloid.get(f.cloid)) || byOid.get(f.oid);
    if (!order) continue; // not placed through this platform
    result.matched++;
    const sourceTime = new Date(f.time);
    const inserted = await db
      .insert(fills)
      .values({
        network,
        hlAddress: hlAddress.toLowerCase(),
        tid: f.tid,
        hlOrderId: f.oid,
        orderId: order.id,
        botId: order.botId,
        userId: order.userId,
        coin: f.coin,
        side: f.side,
        price: f.px,
        size: f.sz,
        closedPnl: f.closedPnl,
        fee: f.fee,
        builderFee: f.builderFee ?? null,
        feeToken: f.feeToken,
        hash: f.hash,
        crossed: f.crossed,
        sourceTime,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) result.newFills++;

    if (order.hlOrderId == null || order.status === "RESTING") {
      await db.update(orders).set({ hlOrderId: f.oid, status: "FILLED", updatedAt: new Date() }).where(eq(orders.id, order.id));
    }

    if (!f.builderFee || order.builderFeeTenthsBp === 0 || !builder) continue;
    const { amount } = parseUsdcE8(f.builderFee);
    if (amount <= 0n) continue;
    const [fillRow] = await db
      .select({ id: fills.id })
      .from(fills)
      .where(and(eq(fills.network, network), eq(fills.tid, f.tid), eq(fills.hlOrderId, f.oid)));
    const policy = await getPolicyAt(db, sourceTime);
    const beneficiaries = await resolveBeneficiaries(db, order.userId);
    const ev = await db
      .insert(feeEvents)
      .values({
        idempotencyKey: `${network}:${f.tid}:${f.oid}`,
        network,
        fillId: fillRow?.id ?? null,
        botId: order.botId,
        traderUserId: order.userId,
        builderAddress: builder,
        amountE8: amount,
        rawAmount: f.builderFee,
        feePolicyVersionId: policy.id,
        tier1PartnerUserId: beneficiaries.tier1,
        tier2PartnerUserId: beneficiaries.tier2,
        wholesalerPortionPpm: beneficiaries.wholesalerPortionPpm,
        status: "OBSERVED",
        occurredAt: sourceTime,
      })
      .onConflictDoNothing()
      .returning();
    if (ev.length) result.newFeeEvents++;
  }
  return result;
}

/** Pulls recent fills for every trading account on the network (worker / admin trigger). */
export async function syncAllAccounts(db: Db, hl: HlGateway) {
  const accounts = await db.select().from(tradingAccounts).where(eq(tradingAccounts.network, hl.network));
  const totals: IngestResult = { fetched: 0, matched: 0, newFills: 0, newFeeEvents: 0 };
  for (const acct of accounts) {
    const since = acct.lastFillSyncAt ? acct.lastFillSyncAt.getTime() - OVERLAP_MS : Date.now() - INITIAL_LOOKBACK_MS;
    const startedAt = new Date();
    const rows = await hl.userFillsByTime(acct.hlAddress, since);
    const r = await ingestFills(db, hl.network, acct.hlAddress, rows);
    for (const k of Object.keys(totals) as (keyof IngestResult)[]) totals[k] += r[k];
    await db.update(tradingAccounts).set({ lastFillSyncAt: startedAt }).where(eq(tradingAccounts.id, acct.id));
  }
  return { accounts: accounts.length, ...totals };
}
