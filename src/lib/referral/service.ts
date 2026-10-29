import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { writeAudit } from "../audit";
import type { Db, DbOrTx } from "../db/client";
import { partners, referralRelations, userRoles } from "../db/schema";
import { conflict } from "../http";
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
 * Makes a user a referral partner (idempotent). The program is not open to the public:
 * in the app only an admin grants it (`grantedByAdminId`), to people they arrange it with personally.
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
 * Freezes the referral relation for a newly registered trader.
 * A → B → C: registering C with B's code gives direct = B, indirect = B's own
 * direct partner (A). Relations are immutable once written (PK on trader).
 */
export async function registerReferral(db: Db, traderUserId: string, code: string): Promise<ReferralResult> {
  const partner = await findPartnerByCode(db, code);
  if (!partner) return { status: "IGNORED", reason: "INVALID_CODE" };
  if (partner.userId === traderUserId) return { status: "IGNORED", reason: "SELF_REFERRAL" };
  if (partner.eligibilityStatus !== "ACTIVE") return { status: "IGNORED", reason: "PARTNER_INELIGIBLE" };

  const [upstream] = await db
    .select()
    .from(referralRelations)
    .where(eq(referralRelations.traderUserId, partner.userId))
    .limit(1);
  const indirect = upstream?.directPartnerUserId ?? null;
  // A cycle can only arise if the trader already sits upstream of the partner.
  if (indirect === traderUserId || upstream?.indirectPartnerUserId === traderUserId) {
    return { status: "IGNORED", reason: "CYCLE" };
  }

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
 * Partner beneficiaries for a trade at this moment: the frozen relation, with
 * any tier whose partner is not ACTIVE set to null (→ unallocated reserve).
 */
export async function resolveBeneficiaries(db: DbOrTx, traderUserId: string) {
  const [rel] = await db
    .select()
    .from(referralRelations)
    .where(eq(referralRelations.traderUserId, traderUserId))
    .limit(1);
  if (!rel) return { tier1: null as string | null, tier2: null as string | null };
  const ids = [rel.directPartnerUserId, rel.indirectPartnerUserId].filter((x): x is string => Boolean(x));
  const active = await db
    .select({ userId: partners.userId })
    .from(partners)
    .where(and(inArray(partners.userId, ids), eq(partners.eligibilityStatus, "ACTIVE")));
  const activeSet = new Set(active.map((a) => a.userId));
  return {
    tier1: activeSet.has(rel.directPartnerUserId) ? rel.directPartnerUserId : null,
    tier2: rel.indirectPartnerUserId && activeSet.has(rel.indirectPartnerUserId) ? rel.indirectPartnerUserId : null,
  };
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
