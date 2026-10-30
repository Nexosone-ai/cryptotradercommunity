import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { writeAudit } from "../audit";
import type { Db, DbOrTx } from "../db/client";
import { partners, referralRelations, userRoles, users } from "../db/schema";
import { badRequest, conflict, forbidden, notFound } from "../http";
import { bi } from "../i18n";

// No 0/O/1/I to avoid transcription mistakes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{6,12}$/;
export const REFERRAL_COOKIE = "ctc_ref";

export function generateReferralCode(length = 8): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function normalizeReferralCode(code: string): string | null {
  const c = code.trim().toUpperCase();
  return REFERRAL_CODE_RE.test(c) ? c : null;
}

/**
 * Makes a user a wholesale partner (idempotent). The program is not open to the public:
 * in the app only an admin grants it (`grantedByAdminId`), to people they arrange it with personally.
 * Wholesale partners refer clients and recruit affiliates with their invite link (joinAsAffiliate).
 */
export async function activatePartner(db: Db, userId: string, actorWallet: string, grantedByAdminId?: string) {
  const [existing] = await db.select().from(partners).where(eq(partners.userId, userId)).limit(1);
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await db
      .insert(partners)
      .values({
        userId,
        referralCode: generateReferralCode(),
        eligibilityStatus: "ACTIVE",
        termsAcceptedAt: new Date(),
        kind: "WHOLESALE",
        affiliateInviteCode: generateReferralCode(10),
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await db
        .insert(userRoles)
        .values({ userId, role: "PARTNER", grantedBy: grantedByAdminId ? `admin:${grantedByAdminId}` : "self:partner-terms" })
        .onConflictDoNothing();
      await writeAudit(db, {
        actorUserId: grantedByAdminId ?? userId,
        actorWallet,
        action: grantedByAdminId ? "PARTNER_GRANTED" : "PARTNER_ACTIVATED",
        targetType: "partner",
        targetId: row.id,
      });
      return row;
    }
    const [raced] = await db.select().from(partners).where(eq(partners.userId, userId)).limit(1);
    if (raced) return raced;
  }
  throw conflict("CODE_GENERATION_FAILED", bi("Couldn't generate a referral code. Please try again.", "추천 코드 생성에 실패했습니다. 다시 시도해 주세요."));
}

export async function findPartnerByCode(db: DbOrTx, code: string) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  const [p] = await db.select().from(partners).where(eq(partners.referralCode, normalized)).limit(1);
  return p ?? null;
}

export type ReferralResult =
  | { status: "REGISTERED"; directPartnerUserId: string; indirectPartnerUserId: string | null }
  | { status: "IGNORED"; reason: "INVALID_CODE" | "SELF_REFERRAL" | "PARTNER_INELIGIBLE" | "ALREADY_REFERRED" | "CYCLE" };

/**
 * Freezes the referral relation for a newly registered client.
 * One level of affiliates: a client referred by an affiliate gets direct = the
 * affiliate and indirect = the affiliate's wholesaler; a client referred by a
 * wholesaler gets direct = the wholesaler and no indirect partner. Clients'
 * own referrals never add levels. Relations are immutable once written (PK on trader).
 */
export async function registerReferral(db: Db, traderUserId: string, code: string): Promise<ReferralResult> {
  const partner = await findPartnerByCode(db, code);
  if (!partner) return { status: "IGNORED", reason: "INVALID_CODE" };
  if (partner.userId === traderUserId) return { status: "IGNORED", reason: "SELF_REFERRAL" };
  if (partner.eligibilityStatus !== "ACTIVE") return { status: "IGNORED", reason: "PARTNER_INELIGIBLE" };
  const indirect = partner.kind === "AFFILIATE" ? partner.wholesalerUserId : null;
  if (indirect === traderUserId) return { status: "IGNORED", reason: "CYCLE" };

  const inserted = await db
    .insert(referralRelations)
    .values({
      traderUserId,
      directPartnerUserId: partner.userId,
      indirectPartnerUserId: indirect,
      referralCode: partner.referralCode,
      frozenAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return { status: "IGNORED", reason: "ALREADY_REFERRED" };
  return { status: "REGISTERED", directPartnerUserId: partner.userId, indirectPartnerUserId: indirect };
}

/**
 * Partner beneficiaries for a trade at this moment, for the wholesale split
 * (lib/fees/split.ts): tier1 = the client's affiliate, tier2 = the wholesaler,
 * plus the wholesaler's current portion. A partner who isn't ACTIVE is null, so
 * their share goes to the platform.
 */
export async function resolveBeneficiaries(db: DbOrTx, traderUserId: string) {
  const none = { tier1: null as string | null, tier2: null as string | null, wholesalerPortionPpm: 0 };
  const [rel] = await db
    .select()
    .from(referralRelations)
    .where(eq(referralRelations.traderUserId, traderUserId))
    .limit(1);
  if (!rel) return none;
  const [direct] = await db.select().from(partners).where(eq(partners.userId, rel.directPartnerUserId)).limit(1);
  if (!direct) return none;
  const isActive = (p: { eligibilityStatus: string } | undefined) => p?.eligibilityStatus === "ACTIVE";
  if (direct.kind === "AFFILIATE") {
    const wholesalerId = rel.indirectPartnerUserId ?? direct.wholesalerUserId;
    const [wholesaler] = wholesalerId ? await db.select().from(partners).where(eq(partners.userId, wholesalerId)).limit(1) : [];
    return {
      tier1: isActive(direct) ? direct.userId : null,
      tier2: wholesaler && isActive(wholesaler) ? wholesaler.userId : null,
      wholesalerPortionPpm: wholesaler?.wholesalerPortionPpm ?? 0,
    };
  }
  return { tier1: null, tier2: isActive(direct) ? direct.userId : null, wholesalerPortionPpm: direct.wholesalerPortionPpm ?? 0 };
}

export async function referralCounts(db: DbOrTx, partnerUserId: string) {
  const [row] = await db
    .select({
      direct: sql<number>`count(*) filter (where ${referralRelations.directPartnerUserId} = ${partnerUserId})`,
      indirect: sql<number>`count(*) filter (where ${referralRelations.indirectPartnerUserId} = ${partnerUserId})`,
    })
    .from(referralRelations);
  return { direct: Number(row?.direct ?? 0), indirect: Number(row?.indirect ?? 0) };
}

// ── Wholesale partners and their affiliates ────────────────────────────────

/** Partner share of the fee under a policy, in ppm of the whole fee (210000 = 21 points). */
export function partnerPoolPpm(policy: { botOwnerSharePpm: number; platformShareOfPoolPpm: number }) {
  return Math.floor(((1_000_000 - policy.botOwnerSharePpm) * (1_000_000 - policy.platformShareOfPoolPpm)) / 1_000_000);
}

export async function findWholesalerByInvite(db: DbOrTx, code: string) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  const [p] = await db
    .select()
    .from(partners)
    .where(and(eq(partners.affiliateInviteCode, normalized), eq(partners.kind, "WHOLESALE")))
    .limit(1);
  return p ?? null;
}

/**
 * A signed-in user accepts a wholesaler's invite and becomes their affiliate.
 * Affiliates refer clients but can't recruit affiliates of their own.
 */
export async function joinAsAffiliate(db: Db, user: { id: string; walletAddress: string }, inviteCode: string) {
  const wholesaler = await findWholesalerByInvite(db, inviteCode);
  if (!wholesaler || wholesaler.eligibilityStatus !== "ACTIVE") throw notFound("This affiliate invite link isn't valid.");
  if (wholesaler.userId === user.id) throw badRequest("SELF_INVITE", "This is your own invite link.");
  if (wholesaler.wholesalerPortionPpm == null) throw conflict("PROGRAM_NOT_READY", "This partner hasn't set up their affiliate program yet.");
  const [existing] = await db.select().from(partners).where(eq(partners.userId, user.id)).limit(1);
  if (existing) throw conflict("ALREADY_PARTNER", "This wallet is already a partner.");
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await db
      .insert(partners)
      .values({
        userId: user.id,
        referralCode: generateReferralCode(),
        eligibilityStatus: "ACTIVE",
        termsAcceptedAt: new Date(),
        kind: "AFFILIATE",
        wholesalerUserId: wholesaler.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await db.insert(userRoles).values({ userId: user.id, role: "PARTNER", grantedBy: `wholesaler:${wholesaler.userId}` }).onConflictDoNothing();
      await writeAudit(db, {
        actorUserId: user.id,
        actorWallet: user.walletAddress,
        action: "AFFILIATE_JOINED",
        targetType: "partner",
        targetId: row.id,
        after: { wholesalerUserId: wholesaler.userId },
      });
      return row;
    }
    const [raced] = await db.select().from(partners).where(eq(partners.userId, user.id)).limit(1);
    if (raced) throw conflict("ALREADY_PARTNER", "This wallet is already a partner.");
  }
  throw conflict("CODE_GENERATION_FAILED", "Couldn't generate a referral code. Please try again.");
}

async function loadWholesaler(db: DbOrTx, userId: string) {
  const [p] = await db.select().from(partners).where(eq(partners.userId, userId)).limit(1);
  if (!p || p.kind !== "WHOLESALE") throw forbidden("Only wholesale partners can manage an affiliate program.");
  return p;
}

/**
 * Wholesaler sets what they keep of each fee their affiliates' clients pay (ppm of the
 * whole fee, at most the partner share). It applies to trades recorded from now on;
 * trades already recorded keep the portion in force when they filled.
 */
export async function setWholesalerPortion(db: Db, user: { id: string; walletAddress: string }, portionPpm: number, maxPpm: number) {
  const p = await loadWholesaler(db, user.id);
  if (!Number.isInteger(portionPpm) || portionPpm < 0 || portionPpm > maxPpm) {
    throw badRequest("PORTION_OUT_OF_RANGE", `Your portion must be between 0 and ${maxPpm / 10_000} points of the fee.`);
  }
  const [row] = await db
    .update(partners)
    .set({ wholesalerPortionPpm: portionPpm, affiliateInviteCode: p.affiliateInviteCode ?? generateReferralCode(10) })
    .where(eq(partners.id, p.id))
    .returning();
  await writeAudit(db, {
    actorUserId: user.id,
    actorWallet: user.walletAddress,
    action: "WHOLESALE_PORTION_SET",
    targetType: "partner",
    targetId: p.id,
    before: { wholesalerPortionPpm: p.wholesalerPortionPpm },
    after: { wholesalerPortionPpm: portionPpm },
  });
  return row;
}

/** A wholesaler's affiliates with the number of clients each brought. */
export async function listAffiliates(db: DbOrTx, wholesalerUserId: string) {
  return db
    .select({
      id: partners.id,
      wallet: users.walletAddress,
      referralCode: partners.referralCode,
      status: partners.eligibilityStatus,
      createdAt: partners.createdAt,
      clients: sql<number>`(select count(*)::int from ${referralRelations} where ${referralRelations.directPartnerUserId} = ${partners.userId})`,
    })
    .from(partners)
    .innerJoin(users, eq(users.id, partners.userId))
    .where(and(eq(partners.wholesalerUserId, wholesalerUserId), eq(partners.kind, "AFFILIATE")))
    .orderBy(desc(partners.createdAt));
}

/** Wholesaler suspends or reactivates one of their own affiliates. A suspended affiliate's share goes to the platform. */
export async function setAffiliateStatus(db: Db, user: { id: string; walletAddress: string }, affiliateId: string, status: "ACTIVE" | "SUSPENDED") {
  await loadWholesaler(db, user.id);
  const [row] = await db
    .update(partners)
    .set({ eligibilityStatus: status })
    .where(and(eq(partners.id, affiliateId), eq(partners.wholesalerUserId, user.id), eq(partners.kind, "AFFILIATE")))
    .returning();
  if (!row) throw notFound("Affiliate not found.");
  await writeAudit(db, {
    actorUserId: user.id,
    actorWallet: user.walletAddress,
    action: status === "ACTIVE" ? "AFFILIATE_REACTIVATED" : "AFFILIATE_SUSPENDED",
    targetType: "partner",
    targetId: row.id,
  });
  return row;
}

/** Ensures a wholesaler has an invite code (partners appointed before the wholesale model have none). */
export async function ensureInviteCode(db: Db, userId: string) {
  const p = await loadWholesaler(db, userId);
  if (p.affiliateInviteCode) return p.affiliateInviteCode;
  const code = generateReferralCode(10);
  await db.update(partners).set({ affiliateInviteCode: code }).where(eq(partners.id, p.id));
  return code;
}
