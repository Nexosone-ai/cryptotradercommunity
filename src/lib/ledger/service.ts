import { and, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { writeAudit } from "../audit";
import type { SessionUser } from "../auth/session";
import type { Db, DbOrTx } from "../db/client";
import { bots, feeEvents, feePolicyVersions, ledgerEntries, payouts, users } from "../db/schema";
import { splitBuilderFee, validatePolicy, type FeePolicyShares } from "../fees/split";
import { badRequest, conflict, forbidden, notFound } from "../http";
import { E8 } from "../money";
import { bi } from "../i18n";

type LedgerAccount = (typeof ledgerEntries.$inferInsert)["account"];

// ── Fee policy versions ───────────────────────────────────────────────────

/** The policy in force at `at` (fill time). Past fills keep their version. */
export async function getPolicyAt(db: DbOrTx, at: Date) {
  const [p] = await db
    .select()
    .from(feePolicyVersions)
    .where(lte(feePolicyVersions.effectiveFrom, at))
    .orderBy(desc(feePolicyVersions.effectiveFrom), desc(feePolicyVersions.version))
    .limit(1);
  if (!p) throw new Error("No fee policy in force");
  return p;
}

export async function listPolicies(db: Db) {
  return db.select().from(feePolicyVersions).orderBy(desc(feePolicyVersions.version));
}

/** New versions only take effect in the future; history is never rewritten. */
export async function createPolicyVersion(
  db: Db,
  admin: SessionUser,
  input: FeePolicyShares & { effectiveFrom: Date; note?: string },
) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  validatePolicy(input);
  if (input.effectiveFrom.getTime() < Date.now() - 60_000) {
    throw badRequest("RETROACTIVE_POLICY", bi("Fee policies can't be applied retroactively.", "수수료 정책은 과거 시점으로 소급 적용할 수 없습니다."));
  }
  return db.transaction(async (tx) => {
    const [last] = await tx.select().from(feePolicyVersions).orderBy(desc(feePolicyVersions.version)).limit(1);
    const version = (last?.version ?? 0) + 1;
    const [row] = await tx
      .insert(feePolicyVersions)
      .values({
        version,
        botOwnerSharePpm: input.botOwnerSharePpm,
        platformShareOfPoolPpm: input.platformShareOfPoolPpm,
        tier1ShareOfPartnerPoolPpm: input.tier1ShareOfPartnerPoolPpm,
        effectiveFrom: input.effectiveFrom,
        status: "ACTIVE",
        approvedBy: admin.id,
        note: input.note ?? null,
      })
      .returning();
    await writeAudit(tx, {
      actorUserId: admin.id,
      actorWallet: admin.walletAddress,
      action: "FEE_POLICY_CREATED",
      targetType: "fee_policy",
      targetId: row.id,
      before: last ?? null,
      after: row,
      reason: input.note,
    });
    return row;
  });
}

// ── Fee events ────────────────────────────────────────────────────────────

/** Confirms observed fee events (revenue verified with Hyperliquid) and allocates them. */
export async function confirmAndAllocate(db: Db, admin: SessionUser, eventIds: string[], reason: string) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  if (!reason.trim()) throw badRequest("REASON_REQUIRED", bi("Please enter the basis for confirmation (reconciliation result).", "확인 근거(대사 결과)를 입력해 주세요."));
  const results: { id: string; status: string }[] = [];
  for (const id of eventIds) {
    const r = await db.transaction(async (tx) => {
      const [ev] = await tx
        .update(feeEvents)
        .set({ status: "CONFIRMED", confirmedAt: new Date(), confirmedBy: admin.id })
        .where(and(eq(feeEvents.id, id), eq(feeEvents.status, "OBSERVED")))
        .returning();
      if (!ev) return { id, status: "SKIPPED" };
      await allocateFeeEvent(tx, ev.id);
      await writeAudit(tx, {
        actorUserId: admin.id,
        actorWallet: admin.walletAddress,
        action: "FEE_EVENT_CONFIRMED",
        targetType: "fee_event",
        targetId: ev.id,
        after: { amountE8: ev.amountE8.toString() },
        reason,
      });
      return { id, status: "ALLOCATED" };
    });
    results.push(r);
  }
  return results;
}

/**
 * Writes the balanced journal for one CONFIRMED event:
 *   Dr BUILDER_FEE_RECEIVABLE  R
 *   Cr each split line         (owner / platform / partners / reserve / rounding)
 * The status guard makes allocation idempotent.
 */
export async function allocateFeeEvent(tx: DbOrTx, eventId: string) {
  const [ev] = await tx
    .update(feeEvents)
    .set({ status: "ALLOCATED" })
    .where(and(eq(feeEvents.id, eventId), eq(feeEvents.status, "CONFIRMED")))
    .returning();
  if (!ev) return null;
  const [policy] = await tx.select().from(feePolicyVersions).where(eq(feePolicyVersions.id, ev.feePolicyVersionId));
  let ownerId: string | null = null;
  if (ev.botId) {
    const [bot] = await tx.select({ ownerUserId: bots.ownerUserId }).from(bots).where(eq(bots.id, ev.botId));
    ownerId = bot?.ownerUserId ?? null;
  }
  const split = splitBuilderFee({
    revenueE8: ev.amountE8,
    policy,
    botOwnerUserId: ownerId,
    tier1PartnerUserId: ev.tier1PartnerUserId,
    tier2PartnerUserId: ev.tier2PartnerUserId,
    wholesalerPortionPpm: ev.wholesalerPortionPpm,
  });
  const journalId = crypto.randomUUID();
  const rows: (typeof ledgerEntries.$inferInsert)[] = [
    { journalId, feeEventId: ev.id, account: "BUILDER_FEE_RECEIVABLE", amountE8: ev.amountE8, memo: "builder fee earned" },
  ];
  for (const line of split.lines) {
    rows.push({
      journalId,
      feeEventId: ev.id,
      account: line.account,
      accountUserId: "userId" in line ? line.userId : null,
      tier: "tier" in line ? line.tier : null,
      amountE8: -line.amountE8,
      memo: "memo" in line ? line.memo : null,
    });
  }
  await tx.insert(ledgerEntries).values(rows);
  return split;
}

// ── Balances & reconciliation ─────────────────────────────────────────────

export async function accountBalances(db: DbOrTx) {
  const rows = await db
    .select({
      account: ledgerEntries.account,
      total: sql<string>`sum(${ledgerEntries.amountE8})`,
    })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.account);
  return Object.fromEntries(rows.map((r) => [r.account, BigInt(r.total ?? "0")])) as Partial<
    Record<LedgerAccount, bigint>
  >;
}

/** Amount owed to a user on a payable account (credit balance shown as positive). */
export async function payableBalance(db: DbOrTx, userId: string, account: "BOT_OWNER_PAYABLE" | "PARTNER_PAYABLE") {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountE8}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, account), eq(ledgerEntries.accountUserId, userId)));
  return -BigInt(row?.total ?? "0");
}

export interface ReconciliationReport {
  allocatedRevenueE8: bigint;
  receivableE8: bigint;
  platformHlBalanceE8: bigint;
  ownerPayableE8: bigint;
  partnerPayableE8: bigint;
  platformNetE8: bigint;
  unallocatedReserveE8: bigint;
  roundingE8: bigint;
  paidOutE8: bigint;
  issues: string[];
}

/**
 * Checks: net_payouts + reserved_unallocated + rounding = realized revenue,
 * per event and in total, and that every journal balances.
 */
export async function reconcile(db: DbOrTx): Promise<ReconciliationReport> {
  const issues: string[] = [];
  const b = await accountBalances(db);
  const [rev] = await db
    .select({ total: sql<string>`coalesce(sum(${feeEvents.amountE8}), 0)` })
    .from(feeEvents)
    .where(eq(feeEvents.status, "ALLOCATED"));
  const allocatedRevenueE8 = BigInt(rev?.total ?? "0");

  const unbalanced = await db
    .select({ journalId: ledgerEntries.journalId, total: sql<string>`sum(${ledgerEntries.amountE8})` })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.journalId)
    .having(sql`sum(${ledgerEntries.amountE8}) <> 0`);
  for (const u of unbalanced) issues.push(`journal ${u.journalId} unbalanced by ${u.total}`);

  const credits = await db
    .select({ feeEventId: ledgerEntries.feeEventId, total: sql<string>`-sum(${ledgerEntries.amountE8})` })
    .from(ledgerEntries)
    .where(and(sql`${ledgerEntries.feeEventId} is not null`, ne(ledgerEntries.account, "BUILDER_FEE_RECEIVABLE")))
    .groupBy(ledgerEntries.feeEventId);
  const creditByEvent = new Map(credits.map((c) => [c.feeEventId, BigInt(c.total ?? "0")]));
  const allocated = await db
    .select({ id: feeEvents.id, amount: feeEvents.amountE8 })
    .from(feeEvents)
    .where(eq(feeEvents.status, "ALLOCATED"));
  for (const e of allocated) {
    const c = creditByEvent.get(e.id) ?? 0n;
    if (c !== e.amount) issues.push(`fee_event ${e.id}: allocations ${c} ≠ revenue ${e.amount}`);
  }

  const [paid] = await db
    .select({ total: sql<string>`coalesce(sum(${payouts.amountE8}), 0)` })
    .from(payouts)
    .where(eq(payouts.status, "PAID"));
  const paidOutE8 = BigInt(paid?.total ?? "0");

  const neg = (v: bigint | undefined) => -(v ?? 0n);
  const report: ReconciliationReport = {
    allocatedRevenueE8,
    receivableE8: b.BUILDER_FEE_RECEIVABLE ?? 0n,
    platformHlBalanceE8: b.PLATFORM_HL_BALANCE ?? 0n,
    ownerPayableE8: neg(b.BOT_OWNER_PAYABLE),
    partnerPayableE8: neg(b.PARTNER_PAYABLE),
    platformNetE8: neg(b.PLATFORM_NET_REVENUE),
    unallocatedReserveE8: neg(b.UNALLOCATED_PARTNER_RESERVE),
    roundingE8: neg(b.ROUNDING_REMAINDER),
    paidOutE8,
    issues,
  };
  const outstanding =
    report.ownerPayableE8 + report.partnerPayableE8 + report.platformNetE8 + report.unallocatedReserveE8 + report.roundingE8;
  if (outstanding + paidOutE8 !== allocatedRevenueE8) {
    issues.push(`allocations+payouts ${outstanding + paidOutE8} ≠ allocated revenue ${allocatedRevenueE8}`);
  }
  return report;
}

// ── Builder reward claims & payouts ───────────────────────────────────────

/** Records that builder rewards were claimed into the platform's Hyperliquid balance. */
export async function recordBuilderClaim(db: Db, admin: SessionUser, amountE8: bigint, reference: string) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  if (amountE8 <= 0n) throw badRequest("INVALID_AMOUNT", bi("The amount is invalid.", "금액이 올바르지 않습니다."));
  const b = await accountBalances(db);
  if (amountE8 > (b.BUILDER_FEE_RECEIVABLE ?? 0n)) {
    throw badRequest("CLAIM_EXCEEDS_RECEIVABLE", bi("The claim amount exceeds the receivable Builder revenue.", "청구 금액이 미수 Builder 수익을 초과합니다."));
  }
  return db.transaction(async (tx) => {
    const journalId = crypto.randomUUID();
    await tx.insert(ledgerEntries).values([
      { journalId, account: "PLATFORM_HL_BALANCE", amountE8, memo: `builder reward claim ${reference}` },
      { journalId, account: "BUILDER_FEE_RECEIVABLE", amountE8: -amountE8, memo: `builder reward claim ${reference}` },
    ]);
    await writeAudit(tx, {
      actorUserId: admin.id,
      actorWallet: admin.walletAddress,
      action: "BUILDER_REWARD_CLAIM_RECORDED",
      targetType: "ledger_journal",
      targetId: journalId,
      after: { amountE8: amountE8.toString(), reference },
    });
    return journalId;
  });
}

/** USDC transfers settle in 6 decimals; sub-micro dust stays in the payable. */
const PAYOUT_UNIT_E8 = 100n;
export const MIN_PAYOUT_E8 = 1n * E8;

export async function createPayout(
  db: Db,
  admin: SessionUser,
  input: { recipientUserId: string; account: "BOT_OWNER_PAYABLE" | "PARTNER_PAYABLE" },
) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  const [recipient] = await db.select().from(users).where(eq(users.id, input.recipientUserId));
  if (!recipient) throw notFound(bi("Recipient not found.", "수령인을 찾을 수 없습니다."));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"payout:" + input.recipientUserId}))`);
    const owed = await payableBalance(tx, input.recipientUserId, input.account);
    const [pending] = await tx
      .select({ total: sql<string>`coalesce(sum(${payouts.amountE8}), 0)` })
      .from(payouts)
      .where(
        and(
          eq(payouts.recipientUserId, input.recipientUserId),
          eq(payouts.account, input.account),
          inArray(payouts.status, ["PENDING_APPROVAL", "APPROVED"]),
        ),
      );
    const available = owed - BigInt(pending?.total ?? "0");
    const amount = (available / PAYOUT_UNIT_E8) * PAYOUT_UNIT_E8;
    if (amount < MIN_PAYOUT_E8) throw badRequest("BELOW_MINIMUM", bi("Below the minimum payout (1 USDC).", "최소 지급액(1 USDC) 미만입니다."));
    const [row] = await tx
      .insert(payouts)
      .values({
        recipientUserId: recipient.id,
        recipientAddress: recipient.walletAddress,
        account: input.account,
        amountE8: amount,
        network: "hyperliquid-usdc",
        status: "PENDING_APPROVAL",
        idempotencyKey: crypto.randomUUID(),
        createdBy: admin.id,
      })
      .returning();
    await writeAudit(tx, {
      actorUserId: admin.id,
      actorWallet: admin.walletAddress,
      action: "PAYOUT_CREATED",
      targetType: "payout",
      targetId: row.id,
      after: { amountE8: amount.toString(), recipient: recipient.walletAddress, account: input.account },
    });
    return row;
  });
}

export async function approvePayout(db: Db, admin: SessionUser, payoutId: string) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(payouts)
      .set({ status: "APPROVED", approvedBy: admin.id, approvedAt: new Date() })
      .where(and(eq(payouts.id, payoutId), eq(payouts.status, "PENDING_APPROVAL")))
      .returning();
    if (!row) throw conflict("PAYOUT_NOT_PENDING", bi("This payout isn't pending approval.", "승인 대기 상태가 아닙니다."));
    await writeAudit(tx, {
      actorUserId: admin.id,
      actorWallet: admin.walletAddress,
      action: "PAYOUT_APPROVED",
      targetType: "payout",
      targetId: row.id,
      reason: row.createdBy === admin.id ? "single-admin approval (creator = approver)" : undefined,
    });
    return row;
  });
}

/**
 * Records a manually executed transfer. Only APPROVED payouts can be marked
 * paid, once; the ledger moves the payable to the platform balance.
 */
export async function markPayoutPaid(db: Db, admin: SessionUser, payoutId: string, txHash: string) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw badRequest("INVALID_TX_HASH", bi("Invalid transaction hash format.", "트랜잭션 해시 형식이 올바르지 않습니다."));
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(payouts).where(eq(payouts.id, payoutId));
    if (!target || target.status !== "APPROVED") throw conflict("PAYOUT_NOT_APPROVED", bi("Only approved payouts can be marked as paid.", "승인된 지급만 완료 처리할 수 있습니다."));
    const cash = (await accountBalances(tx)).PLATFORM_HL_BALANCE ?? 0n;
    if (cash < target.amountE8) {
      throw conflict("INSUFFICIENT_CLAIMED_FUNDS", bi("The claimed Builder revenue on record is less than the payout amount.", "청구(claim) 기록된 Builder 수익이 지급액보다 적습니다."));
    }
    const [row] = await tx
      .update(payouts)
      .set({ status: "PAID", txHash, paidAt: new Date(), attempts: sql`${payouts.attempts} + 1` })
      .where(and(eq(payouts.id, payoutId), eq(payouts.status, "APPROVED")))
      .returning();
    if (!row) throw conflict("PAYOUT_NOT_APPROVED", bi("Only approved payouts can be marked as paid.", "승인된 지급만 완료 처리할 수 있습니다."));
    const journalId = crypto.randomUUID();
    await tx.insert(ledgerEntries).values([
      {
        journalId,
        payoutId: row.id,
        account: row.account,
        accountUserId: row.recipientUserId,
        amountE8: row.amountE8,
        memo: `payout ${txHash}`,
      },
      { journalId, payoutId: row.id, account: "PLATFORM_HL_BALANCE", amountE8: -row.amountE8, memo: `payout ${txHash}` },
    ]);
    await writeAudit(tx, {
      actorUserId: admin.id,
      actorWallet: admin.walletAddress,
      action: "PAYOUT_MARKED_PAID",
      targetType: "payout",
      targetId: row.id,
      after: { txHash, amountE8: row.amountE8.toString() },
    });
    return row;
  });
}
