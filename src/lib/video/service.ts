import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { writeAudit } from "../audit";
import type { SessionUser } from "../auth/session";
import type { Db, DbOrTx } from "../db/client";
import {
  customerInvoices,
  ledgerEntries,
  partnerCreditTopups,
  partnerSettlements,
  partners,
  users,
  videoJobs,
  videoOutputs,
} from "../db/schema";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../http";
import type { FxProvider } from "../fx";
import { E8 } from "../money";
import type { FalGateway } from "./fal";
import { creditPackagesUsd, quotePackages } from "./packages";
import { CLIPS_PER_JOB, DEFAULT_MARKUP_PPM, quoteVideoJob, VIDEO_MODEL, type Resolution } from "./models";

// ── Settings ────────────────────────────────────────────────────────────────

export function videoSettings() {
  const markup = Number(process.env.VIDEO_MARKUP_PPM || DEFAULT_MARKUP_PPM);
  return {
    falConfigured: Boolean(process.env.FAL_KEY),
    markupPpm: Number.isInteger(markup) && markup >= 1_000_000 ? markup : DEFAULT_MARKUP_PPM,
    company: {
      name: process.env.COMPANY_NAME || "",
      bankName: process.env.COMPANY_BANK_NAME || "",
      bankAccount: process.env.COMPANY_BANK_ACCOUNT || "",
      bankHolder: process.env.COMPANY_BANK_HOLDER || "",
    },
  };
}

function companyBank() {
  const c = videoSettings().company;
  if (!c.name || !c.bankName || !c.bankAccount || !c.bankHolder) {
    throw new ApiError(503, "COMPANY_BANK_NOT_CONFIGURED", "회사 입금 계좌가 설정되지 않았습니다. 관리자에게 문의하세요.");
  }
  return c;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function code(prefix: string) {
  return prefix + Array.from(randomBytes(7), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

async function requirePartner(db: DbOrTx, user: SessionUser) {
  if (!user.roles.includes("PARTNER")) throw forbidden("파트너만 이용할 수 있습니다.");
  const [p] = await db.select().from(partners).where(eq(partners.userId, user.id)).limit(1);
  if (!p || p.eligibilityStatus !== "ACTIVE") throw forbidden("활성 파트너만 이용할 수 있습니다.");
  return p;
}

type Line = { account: (typeof ledgerEntries.$inferInsert)["account"]; userId?: string | null; amountE8: bigint; memo: string };

async function journal(tx: DbOrTx, lines: Line[]) {
  const journalId = crypto.randomUUID();
  await tx.insert(ledgerEntries).values(
    lines.map((l) => ({ journalId, account: l.account, accountUserId: l.userId ?? null, amountE8: l.amountE8, memo: l.memo })),
  );
  return journalId;
}

async function balance(db: DbOrTx, account: Line["account"], userId: string) {
  const [r] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountE8}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, account), eq(ledgerEntries.accountUserId, userId)));
  return -BigInt(r?.total ?? "0");
}

export const creditBalance = (db: DbOrTx, userId: string) => balance(db, "PARTNER_CREDIT", userId);
export const invoicePayable = (db: DbOrTx, userId: string) => balance(db, "PARTNER_INVOICE_PAYABLE", userId);

async function lockPartner(tx: DbOrTx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"partner-money:" + userId}))`);
}

// ── Credits ─────────────────────────────────────────────────────────────────

/** Current KRW (VAT included) prices of every credit package. */
export async function packageQuotes(fx: FxProvider) {
  let rate;
  try {
    rate = await fx.usdKrw();
  } catch {
    throw new ApiError(503, "FX_UNAVAILABLE", "환율 정보를 가져오지 못했습니다. 잠시 후 다시 시도하세요.");
  }
  return { fx: rate, packages: quotePackages(rate) };
}

/**
 * Requests a credit package. The KRW price (USD × current rate + 10% VAT) is
 * locked into the request so the admin can match the bank deposit exactly.
 */
export async function requestTopup(db: Db, fx: FxProvider, user: SessionUser, packageUsd: number) {
  await requirePartner(db, user);
  if (!creditPackagesUsd().includes(packageUsd)) throw badRequest("INVALID_PACKAGE", "제공하지 않는 크레딧 패키지입니다.");
  const bank = companyBank();
  const { fx: rate, packages } = await packageQuotes(fx);
  const q = packages.find((x) => x.usd === packageUsd)!;
  const [row] = await db
    .insert(partnerCreditTopups)
    .values({
      partnerUserId: user.id,
      requestedE8: BigInt(packageUsd) * E8,
      referenceCode: code("TOP-"),
      status: "PENDING",
      fxRate: rate.rate,
      fxSource: rate.source,
      fxAsOf: rate.asOf,
      krwSupply: q.supply,
      krwVat: q.vat,
      krwTotal: q.total,
    })
    .returning();
  return { topup: row, bank };
}

export async function reviewTopup(db: Db, admin: SessionUser, topupId: string, decision: "APPROVE" | "REJECT", approvedE8?: bigint, note?: string) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(partnerCreditTopups).where(eq(partnerCreditTopups.id, topupId));
    if (!t) throw notFound("충전 요청을 찾을 수 없습니다.");
    if (t.status !== "PENDING") throw conflict("TOPUP_NOT_PENDING", "이미 처리된 충전 요청입니다.");
    if (decision === "REJECT") {
      if (!note?.trim()) throw badRequest("REASON_REQUIRED", "거절 사유를 입력하세요.");
      const [r] = await tx
        .update(partnerCreditTopups)
        .set({ status: "REJECTED", reviewedBy: admin.id, reviewedAt: new Date(), note })
        .where(eq(partnerCreditTopups.id, t.id))
        .returning();
      await writeAudit(tx, { actorUserId: admin.id, actorWallet: admin.walletAddress, action: "CREDIT_TOPUP_REJECTED", targetType: "credit_topup", targetId: t.id, reason: note });
      return r;
    }
    const amount = approvedE8 ?? t.requestedE8;
    if (amount <= 0n) throw badRequest("INVALID_AMOUNT", "확인된 입금액이 올바르지 않습니다.");
    const [r] = await tx
      .update(partnerCreditTopups)
      .set({ status: "APPROVED", approvedE8: amount, reviewedBy: admin.id, reviewedAt: new Date(), note: note ?? null })
      .where(and(eq(partnerCreditTopups.id, t.id), eq(partnerCreditTopups.status, "PENDING")))
      .returning();
    if (!r) throw conflict("TOPUP_NOT_PENDING", "이미 처리된 충전 요청입니다.");
    await journal(tx, [
      { account: "COMPANY_BANK", amountE8: amount, memo: `credit top-up ${t.referenceCode}` },
      { account: "PARTNER_CREDIT", userId: t.partnerUserId, amountE8: -amount, memo: `credit top-up ${t.referenceCode}` },
    ]);
    await writeAudit(tx, {
      actorUserId: admin.id,
      actorWallet: admin.walletAddress,
      action: "CREDIT_TOPUP_APPROVED",
      targetType: "credit_topup",
      targetId: t.id,
      after: { amountE8: amount.toString(), referenceCode: t.referenceCode },
      reason: note,
    });
    return r;
  });
}

// ── Video jobs ──────────────────────────────────────────────────────────────

export interface CreateJobInput {
  sourceVideoUrl: string;
  resolution: Resolution;
  clipSeconds: number;
  brief?: string;
  rightsConfirmed: boolean;
}

function webhookUrl(appUrl: URL) {
  const token = process.env.FAL_WEBHOOK_TOKEN;
  if (!token || appUrl.hostname === "localhost") return undefined; // dev: status is polled instead
  return new URL(`/api/webhooks/fal?token=${encodeURIComponent(token)}`, appUrl).toString();
}

/**
 * Charges the partner's credit (cost × markup), plans 10 variations from a
 * frame of the uploaded video and queues the 10 generations on fal.ai.
 * Anything that fails before a clip is queued is refunded to the credit.
 */
export async function createVideoJob(db: Db, fal: FalGateway, user: SessionUser, input: CreateJobInput, appUrl: URL) {
  await requirePartner(db, user);
  const settings = videoSettings();
  if (!settings.falConfigured) throw new ApiError(503, "FAL_NOT_CONFIGURED", "영상 생성 서비스가 아직 설정되지 않았습니다.");
  if (input.rightsConfirmed !== true) throw badRequest("RIGHTS_REQUIRED", "업로드한 영상의 사용 권리 확인이 필요합니다.");
  let src: URL;
  try {
    src = new URL(input.sourceVideoUrl);
  } catch {
    throw badRequest("INVALID_SOURCE", "영상 주소가 올바르지 않습니다.");
  }
  if (src.protocol !== "https:" || !/(^|\.)fal\.(media|ai|run)$/.test(src.hostname)) {
    throw badRequest("INVALID_SOURCE", "영상은 이 페이지의 업로드 기능으로 올려야 합니다.");
  }
  let quote;
  try {
    quote = quoteVideoJob(input.resolution, input.clipSeconds, settings.markupPpm);
  } catch (e) {
    throw badRequest("INVALID_OPTIONS", e instanceof Error ? e.message : "옵션이 올바르지 않습니다.");
  }

  // 1. Charge credit atomically.
  const job = await db.transaction(async (tx) => {
    await lockPartner(tx, user.id);
    const bal = await creditBalance(tx, user.id);
    if (bal < quote.priceE8) {
      throw new ApiError(402, "INSUFFICIENT_CREDIT", "크레딧이 부족합니다. 충전 후 다시 시도하세요.", {
        balanceE8: bal.toString(),
        priceE8: quote.priceE8.toString(),
      });
    }
    const [j] = await tx
      .insert(videoJobs)
      .values({
        partnerUserId: user.id,
        model: VIDEO_MODEL,
        resolution: input.resolution,
        clipSeconds: input.clipSeconds,
        clipCount: quote.clipCount,
        sourceVideoUrl: src.toString(),
        brief: input.brief?.slice(0, 1000) || null,
        status: "ANALYZING",
        costE8: quote.costE8,
        priceE8: quote.priceE8,
        analysisPriceE8: quote.analysisPriceE8,
        clipPriceE8: quote.clipPriceE8,
        rightsConfirmedAt: new Date(),
      })
      .returning();
    await journal(tx, [
      { account: "PARTNER_CREDIT", userId: user.id, amountE8: quote.priceE8, memo: `video job ${j.id}` },
      { account: "VIDEO_SERVICE_REVENUE", amountE8: -quote.priceE8, memo: `video job ${j.id}` },
    ]);
    return j;
  });

  // 2. Analyse and plan.
  let frameUrl: string;
  let plan: { description: string; prompts: string[] };
  try {
    frameUrl = await fal.extractFrame(job.sourceVideoUrl);
    plan = await fal.planVariations(frameUrl, input.brief ?? "", CLIPS_PER_JOB);
  } catch (e) {
    await failJob(db, job.id, `분석 실패: ${e instanceof Error ? e.message : String(e)}`, job.priceE8);
    throw new ApiError(502, "ANALYSIS_FAILED", "영상 분석에 실패해 크레딧을 전액 환불했습니다. 다른 영상으로 다시 시도하세요.");
  }
  await db.update(videoJobs).set({ frameUrl, description: plan.description, updatedAt: new Date() }).where(eq(videoJobs.id, job.id));

  // 3. Queue generations.
  const hook = webhookUrl(appUrl);
  await db.insert(videoOutputs).values(plan.prompts.map((prompt, idx) => ({ jobId: job.id, idx, prompt, status: "QUEUED" })));
  const outputs = await db.select().from(videoOutputs).where(eq(videoOutputs.jobId, job.id)).orderBy(videoOutputs.idx);
  for (const o of outputs) {
    try {
      const requestId = await fal.submitVideo({ prompt: o.prompt, imageUrl: frameUrl, seconds: input.clipSeconds, resolution: input.resolution }, hook);
      await db.update(videoOutputs).set({ falRequestId: requestId }).where(eq(videoOutputs.id, o.id));
    } catch (e) {
      await markOutputFailed(db, o.id, `제출 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await db.update(videoJobs).set({ status: "GENERATING", updatedAt: new Date() }).where(eq(videoJobs.id, job.id));
  await finishIfDone(db, job.id);
  return getJob(db, user, job.id);
}

async function failJob(db: Db, jobId: string, error: string, refundE8: bigint) {
  await db.transaction(async (tx) => {
    const [j] = await tx
      .update(videoJobs)
      .set({ status: "FAILED", error: error.slice(0, 500), refundedE8: refundE8, updatedAt: new Date() })
      .where(and(eq(videoJobs.id, jobId), eq(videoJobs.status, "ANALYZING")))
      .returning();
    if (!j) return;
    await journal(tx, [
      { account: "VIDEO_SERVICE_REVENUE", amountE8: refundE8, memo: `refund video job ${jobId}` },
      { account: "PARTNER_CREDIT", userId: j.partnerUserId, amountE8: -refundE8, memo: `refund video job ${jobId}` },
    ]);
  });
}

/** Marks a clip failed and refunds its share of the price (once). */
async function markOutputFailed(db: Db, outputId: string, error: string) {
  await db.transaction(async (tx) => {
    const [o] = await tx
      .update(videoOutputs)
      .set({ status: "FAILED", error: error.slice(0, 500), refunded: true, completedAt: new Date() })
      .where(and(eq(videoOutputs.id, outputId), eq(videoOutputs.refunded, false), inArray(videoOutputs.status, ["QUEUED", "IN_PROGRESS"])))
      .returning();
    if (!o) return;
    const [j] = await tx.select().from(videoJobs).where(eq(videoJobs.id, o.jobId));
    await tx
      .update(videoJobs)
      .set({ refundedE8: sql`${videoJobs.refundedE8} + ${j.clipPriceE8}`, updatedAt: new Date() })
      .where(eq(videoJobs.id, j.id));
    await journal(tx, [
      { account: "VIDEO_SERVICE_REVENUE", amountE8: j.clipPriceE8, memo: `refund clip ${o.idx} of job ${j.id}` },
      { account: "PARTNER_CREDIT", userId: j.partnerUserId, amountE8: -j.clipPriceE8, memo: `refund clip ${o.idx} of job ${j.id}` },
    ]);
  });
}

async function finishIfDone(db: Db, jobId: string) {
  const outs = await db.select().from(videoOutputs).where(eq(videoOutputs.jobId, jobId));
  if (outs.length === 0 || outs.some((o) => o.status === "QUEUED" || o.status === "IN_PROGRESS")) return;
  const ok = outs.filter((o) => o.status === "COMPLETED").length;
  const status = ok === outs.length ? "COMPLETED" : ok === 0 ? "FAILED" : "PARTIAL";
  await db.update(videoJobs).set({ status, updatedAt: new Date() }).where(and(eq(videoJobs.id, jobId), eq(videoJobs.status, "GENERATING")));
}

/** Pulls the result of one fal request (webhook trigger or polling). Idempotent. */
export async function syncOutputByRequestId(db: Db, fal: FalGateway, requestId: string) {
  const [o] = await db.select().from(videoOutputs).where(eq(videoOutputs.falRequestId, requestId)).limit(1);
  if (!o) return null;
  if (o.status === "COMPLETED" || o.status === "FAILED") return o;
  const r = await fal.videoResult(requestId);
  if (r.status === "COMPLETED") {
    await db
      .update(videoOutputs)
      .set({ status: "COMPLETED", videoUrl: r.videoUrl, completedAt: new Date(), lastCheckedAt: new Date() })
      .where(and(eq(videoOutputs.id, o.id), inArray(videoOutputs.status, ["QUEUED", "IN_PROGRESS"])));
  } else if (r.status === "FAILED") {
    await markOutputFailed(db, o.id, r.error);
  } else {
    await db
      .update(videoOutputs)
      .set({ status: r.status === "IN_PROGRESS" ? "IN_PROGRESS" : "QUEUED", lastCheckedAt: new Date() })
      .where(eq(videoOutputs.id, o.id));
  }
  await finishIfDone(db, o.jobId);
  return o;
}

const POLL_INTERVAL_MS = 10_000;

/** Refreshes unfinished clips of a job (at most every 10s per clip). */
export async function refreshJob(db: Db, fal: FalGateway, jobId: string) {
  const pending = await db
    .select()
    .from(videoOutputs)
    .where(and(eq(videoOutputs.jobId, jobId), inArray(videoOutputs.status, ["QUEUED", "IN_PROGRESS"])));
  const now = Date.now();
  for (const o of pending) {
    if (!o.falRequestId) continue;
    if (o.lastCheckedAt && now - o.lastCheckedAt.getTime() < POLL_INTERVAL_MS) continue;
    try {
      await syncOutputByRequestId(db, fal, o.falRequestId);
    } catch {
      // transient fal/network error: try again on the next refresh
    }
  }
}

export async function getJob(db: Db, user: SessionUser, jobId: string) {
  const [j] = await db.select().from(videoJobs).where(eq(videoJobs.id, jobId)).limit(1);
  if (!j || (j.partnerUserId !== user.id && !user.roles.includes("ADMIN"))) throw notFound("작업을 찾을 수 없습니다.");
  const outputs = await db.select().from(videoOutputs).where(eq(videoOutputs.jobId, j.id)).orderBy(videoOutputs.idx);
  return { job: j, outputs };
}

export async function listJobs(db: Db, partnerUserId: string) {
  return db.select().from(videoJobs).where(eq(videoJobs.partnerUserId, partnerUserId)).orderBy(desc(videoJobs.createdAt)).limit(50);
}

// ── Customer invoices ───────────────────────────────────────────────────────

export interface CreateInvoiceInput {
  issuerName: string;
  customerName: string;
  description: string;
  amountE8: bigint;
  jobId?: string;
}

/**
 * Partner-priced invoice paid into the company account. When linked to a job,
 * the price may not be below what the partner paid for that job.
 */
export async function createInvoice(db: Db, user: SessionUser, input: CreateInvoiceInput) {
  await requirePartner(db, user);
  companyBank();
  if (input.amountE8 <= 0n) throw badRequest("INVALID_AMOUNT", "청구 금액이 올바르지 않습니다.");
  for (const [k, v, max] of [
    ["발행자명", input.issuerName, 80],
    ["고객명", input.customerName, 80],
    ["내역", input.description, 1000],
  ] as const) {
    if (!v.trim() || v.length > max) throw badRequest("INVALID_FIELD", `${k}을(를) 1~${max}자로 입력하세요.`);
  }
  if (input.jobId) {
    const [j] = await db.select().from(videoJobs).where(eq(videoJobs.id, input.jobId)).limit(1);
    if (!j || j.partnerUserId !== user.id) throw notFound("연결할 영상 작업을 찾을 수 없습니다.");
    const paid = j.priceE8 - j.refundedE8;
    if (input.amountE8 < paid) {
      throw badRequest("BELOW_PLATFORM_PRICE", "청구 금액은 이 작업의 플랫폼 이용료보다 낮을 수 없습니다.", { minimumE8: paid.toString() });
    }
  }
  const [row] = await db
    .insert(customerInvoices)
    .values({
      partnerUserId: user.id,
      jobId: input.jobId ?? null,
      issuerName: input.issuerName.trim(),
      customerName: input.customerName.trim(),
      description: input.description.trim(),
      amountE8: input.amountE8,
      publicToken: randomBytes(18).toString("base64url"),
      referenceCode: code("INV-"),
      status: "ISSUED",
    })
    .returning();
  return row;
}

export async function cancelInvoice(db: Db, user: SessionUser, invoiceId: string) {
  const [row] = await db
    .update(customerInvoices)
    .set({ status: "CANCELLED" })
    .where(and(eq(customerInvoices.id, invoiceId), eq(customerInvoices.partnerUserId, user.id), eq(customerInvoices.status, "ISSUED")))
    .returning();
  if (!row) throw conflict("INVOICE_NOT_CANCELLABLE", "발행 상태의 본인 청구서만 취소할 수 있습니다.");
  return row;
}

/** Admin confirms the customer's transfer into the company account → partner earnings. */
export async function markInvoicePaid(db: Db, admin: SessionUser, invoiceId: string, note?: string) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(customerInvoices)
      .set({ status: "PAID", paidConfirmedBy: admin.id, paidAt: new Date() })
      .where(and(eq(customerInvoices.id, invoiceId), eq(customerInvoices.status, "ISSUED")))
      .returning();
    if (!row) throw conflict("INVOICE_NOT_ISSUED", "발행 상태의 청구서만 입금 확인할 수 있습니다.");
    await journal(tx, [
      { account: "COMPANY_BANK", amountE8: row.amountE8, memo: `customer invoice ${row.referenceCode}` },
      { account: "PARTNER_INVOICE_PAYABLE", userId: row.partnerUserId, amountE8: -row.amountE8, memo: `customer invoice ${row.referenceCode}` },
    ]);
    await writeAudit(tx, {
      actorUserId: admin.id,
      actorWallet: admin.walletAddress,
      action: "CUSTOMER_INVOICE_PAID",
      targetType: "customer_invoice",
      targetId: row.id,
      after: { amountE8: row.amountE8.toString(), referenceCode: row.referenceCode },
      reason: note,
    });
    return row;
  });
}

export async function getPublicInvoice(db: Db, token: string) {
  const [row] = await db.select().from(customerInvoices).where(eq(customerInvoices.publicToken, token)).limit(1);
  return row ?? null;
}

export async function listInvoices(db: Db, partnerUserId: string) {
  return db.select().from(customerInvoices).where(eq(customerInvoices.partnerUserId, partnerUserId)).orderBy(desc(customerInvoices.createdAt)).limit(200);
}

// ── Settlements ─────────────────────────────────────────────────────────────

/** Records a bank transfer from the company to the partner (≤ earnings owed). */
export async function settlePartner(db: Db, admin: SessionUser, partnerUserId: string, amountE8: bigint, bankReference: string) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  if (amountE8 <= 0n) throw badRequest("INVALID_AMOUNT", "정산 금액이 올바르지 않습니다.");
  if (!bankReference.trim()) throw badRequest("REFERENCE_REQUIRED", "송금 참조(이체 기록)를 입력하세요.");
  return db.transaction(async (tx) => {
    await lockPartner(tx, partnerUserId);
    const owed = await invoicePayable(tx, partnerUserId);
    if (amountE8 > owed) throw conflict("EXCEEDS_PAYABLE", "정산 금액이 미지급 정산금보다 큽니다.");
    const [row] = await tx
      .insert(partnerSettlements)
      .values({ partnerUserId, amountE8, bankReference: bankReference.trim(), createdBy: admin.id })
      .returning();
    await journal(tx, [
      { account: "PARTNER_INVOICE_PAYABLE", userId: partnerUserId, amountE8, memo: `settlement ${row.id}` },
      { account: "COMPANY_BANK", amountE8: -amountE8, memo: `settlement ${row.id}` },
    ]);
    await writeAudit(tx, {
      actorUserId: admin.id,
      actorWallet: admin.walletAddress,
      action: "PARTNER_SETTLEMENT_RECORDED",
      targetType: "partner",
      targetId: partnerUserId,
      after: { amountE8: amountE8.toString(), bankReference },
    });
    return row;
  });
}

// ── Summaries ───────────────────────────────────────────────────────────────

export async function partnerServiceSummary(db: Db, user: SessionUser) {
  await requirePartner(db, user);
  const [topups, settlements] = await Promise.all([
    db.select().from(partnerCreditTopups).where(eq(partnerCreditTopups.partnerUserId, user.id)).orderBy(desc(partnerCreditTopups.createdAt)).limit(50),
    db.select().from(partnerSettlements).where(eq(partnerSettlements.partnerUserId, user.id)).orderBy(desc(partnerSettlements.createdAt)).limit(50),
  ]);
  return {
    creditE8: await creditBalance(db, user.id),
    invoicePayableE8: await invoicePayable(db, user.id),
    topups,
    settlements,
    settings: { ...videoSettings(), company: undefined, companyConfigured: Boolean(videoSettings().company.bankAccount) },
  };
}

export async function adminPartnerServices(db: Db) {
  const [topups, invoices, jobs, payables] = await Promise.all([
    db
      .select({ t: partnerCreditTopups, wallet: users.walletAddress })
      .from(partnerCreditTopups)
      .innerJoin(users, eq(users.id, partnerCreditTopups.partnerUserId))
      .orderBy(desc(partnerCreditTopups.createdAt))
      .limit(200),
    db
      .select({ i: customerInvoices, wallet: users.walletAddress })
      .from(customerInvoices)
      .innerJoin(users, eq(users.id, customerInvoices.partnerUserId))
      .orderBy(desc(customerInvoices.createdAt))
      .limit(200),
    db
      .select({
        count: sql<number>`count(*)`,
        cost: sql<string>`coalesce(sum(${videoJobs.costE8}), 0)`,
        price: sql<string>`coalesce(sum(${videoJobs.priceE8}), 0)`,
        refunded: sql<string>`coalesce(sum(${videoJobs.refundedE8}), 0)`,
      })
      .from(videoJobs),
    db
      .select({
        userId: ledgerEntries.accountUserId,
        wallet: users.walletAddress,
        owed: sql<string>`-sum(${ledgerEntries.amountE8})`,
      })
      .from(ledgerEntries)
      .innerJoin(users, eq(users.id, ledgerEntries.accountUserId))
      .where(eq(ledgerEntries.account, "PARTNER_INVOICE_PAYABLE"))
      .groupBy(ledgerEntries.accountUserId, users.walletAddress)
      .having(sql`sum(${ledgerEntries.amountE8}) <> 0`),
  ]);
  return {
    topups,
    invoices,
    jobs: {
      count: Number(jobs[0]?.count ?? 0),
      costE8: BigInt(jobs[0]?.cost ?? "0"),
      priceE8: BigInt(jobs[0]?.price ?? "0"),
      refundedE8: BigInt(jobs[0]?.refunded ?? "0"),
    },
    payables: payables.map((p) => ({ ...p, owed: BigInt(p.owed) })),
    settings: videoSettings(),
  };
}
