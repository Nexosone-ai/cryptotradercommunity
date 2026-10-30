import { desc, eq, sql } from "drizzle-orm";
import { isAddress } from "viem";
import { writeAudit } from "../audit";
import type { Db } from "../db/client";
import { partners, referralRelations, users } from "../db/schema";
import { badRequest, notFound } from "../http";
import { activatePartner } from "./service";

/**
 * The referral program is not a public offer. An admin appoints each wholesale
 * partner personally from the admin console; affiliates join only through a
 * wholesale partner's invite link (lib/referral/service.ts#joinAsAffiliate).
 */
export async function listPartners(db: Db) {
  return db
    .select({
      id: partners.id,
      userId: partners.userId,
      wallet: users.walletAddress,
      referralCode: partners.referralCode,
      eligibilityStatus: partners.eligibilityStatus,
      kind: partners.kind,
      wholesalerPortionPpm: partners.wholesalerPortionPpm,
      wholesalerWallet: sql<string | null>`(select u.wallet_address from users u where u.id = ${partners.wholesalerUserId})`,
      createdAt: partners.createdAt,
      direct: sql<number>`(select count(*)::int from ${referralRelations} where ${referralRelations.directPartnerUserId} = ${partners.userId})`,
      indirect: sql<number>`(select count(*)::int from ${referralRelations} where ${referralRelations.indirectPartnerUserId} = ${partners.userId})`,
    })
    .from(partners)
    .innerJoin(users, eq(users.id, partners.userId))
    .orderBy(desc(partners.createdAt));
}

export async function grantPartner(db: Db, admin: { id: string; walletAddress: string }, walletAddress: string) {
  if (!isAddress(walletAddress, { strict: false })) throw badRequest("INVALID_ADDRESS", "Invalid wallet address.");
  const [user] = await db.select().from(users).where(eq(users.walletAddress, walletAddress.toLowerCase())).limit(1);
  if (!user) {
    throw notFound("This wallet hasn't signed in yet. Ask them to connect MetaMask on the site once, then try again.");
  }
  return activatePartner(db, user.id, admin.walletAddress, admin.id);
}

export async function setPartnerStatus(db: Db, admin: { id: string; walletAddress: string }, partnerId: string, status: "ACTIVE" | "SUSPENDED") {
  const [row] = await db.update(partners).set({ eligibilityStatus: status }).where(eq(partners.id, partnerId)).returning();
  if (!row) throw notFound("Partner not found.");
  await writeAudit(db, {
    actorUserId: admin.id,
    actorWallet: admin.walletAddress,
    action: status === "ACTIVE" ? "PARTNER_REACTIVATED" : "PARTNER_SUSPENDED",
    targetType: "partner",
    targetId: row.id,
  });
  return row;
}
