import { and, eq } from "drizzle-orm";
import type { Hex } from "viem";
import { writeAudit } from "../audit";
import { getConfig } from "../config";
import type { Db } from "../db/client";
import { userRoles, users } from "../db/schema";
import { badRequest } from "../http";
import { registerReferral } from "../referral/service";
import { createSession, type Role } from "./session";
import { verifySiweSignature } from "./siwe";
import { bi } from "../i18n";

export interface SignInInput {
  message: string;
  signature: Hex;
  expectedDomain: string;
  acceptTerms: boolean;
  referralCode?: string | null;
}

export async function grantRole(db: Db, userId: string, role: Role, grantedBy: string | null) {
  const inserted = await db
    .insert(userRoles)
    .values({ userId, role, grantedBy })
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0;
}

/**
 * Completes MetaMask sign-in. First sign-in creates the user (terms consent
 * required) and freezes the referral relation if a referral code was captured.
 * Returns a new session token; the caller sets the cookie.
 */
export async function signIn(db: Db, input: SignInInput) {
  const { address, chainId } = await verifySiweSignature(db, input);
  const cfg = getConfig();

  let [user] = await db.select().from(users).where(eq(users.walletAddress, address)).limit(1);
  let isNew = false;
  if (!user) {
    if (!input.acceptTerms) {
      throw badRequest("TERMS_REQUIRED", bi("On your first sign-in, you must accept the terms of use and the risk disclosure.", "첫 로그인 시 이용약관과 위험 고지에 동의해야 합니다."));
    }
    [user] = await db
      .insert(users)
      .values({ walletAddress: address, termsAcceptedAt: new Date() })
      .onConflictDoNothing()
      .returning();
    if (!user) {
      [user] = await db.select().from(users).where(eq(users.walletAddress, address)).limit(1);
    } else {
      isNew = true;
      await grantRole(db, user.id, "TRADER", null);
    }
  }
  if (user.status !== "ACTIVE") throw badRequest("ACCOUNT_DISABLED", bi("This account is restricted.", "이용이 제한된 계정입니다."));

  let referral: Awaited<ReturnType<typeof registerReferral>> | null = null;
  if (isNew && input.referralCode) {
    referral = await registerReferral(db, user.id, input.referralCode);
  }

  // Bootstrap admin from env. Audited so the grant is visible later.
  if (cfg.adminWallet && cfg.adminWallet.toLowerCase() === address) {
    const [existing] = await db
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, user.id), eq(userRoles.role, "ADMIN")));
    if (!existing) {
      await grantRole(db, user.id, "ADMIN", "env:ADMIN_WALLET_ADDRESS");
      await writeAudit(db, {
        actorUserId: user.id,
        actorWallet: address,
        action: "ADMIN_BOOTSTRAP_GRANT",
        targetType: "user",
        targetId: user.id,
        reason: "ADMIN_WALLET_ADDRESS matched on sign-in",
      });
    }
  }

  const session = await createSession(db, user.id, address, chainId);
  return { user, isNew, referral, session };
}
