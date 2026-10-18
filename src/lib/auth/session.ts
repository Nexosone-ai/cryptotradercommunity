import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { sessions, userRoles, users } from "../db/schema";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-ctc_session" : "ctc_session";

const globalForSecret = globalThis as unknown as { __ctcDevSecret?: string };

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (32+ chars) is required in production");
  }
  globalForSecret.__ctcDevSecret ??= randomBytes(32).toString("hex");
  return globalForSecret.__ctcDevSecret;
}

export function hashToken(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export async function createSession(db: Db, userId: string, walletAddress: string, chainId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, walletAddress, chainId, expiresAt });
  return { token, expiresAt };
}

export async function revokeSession(db: Db, token: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
}

export type Role = "TRADER" | "BOT_OWNER" | "PARTNER" | "ADMIN";

export interface SessionUser {
  id: string;
  walletAddress: `0x${string}`;
  roles: Role[];
  sessionId: string;
  chainId: number;
}

export async function loadSessionUser(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const now = new Date();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row || row.user.status !== "ACTIVE") return null;
  if (row.session.walletAddress !== row.user.walletAddress) return null;
  const roles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, row.user.id));
  return {
    id: row.user.id,
    walletAddress: row.user.walletAddress as `0x${string}`,
    roles: roles.map((r) => r.role),
    sessionId: row.session.id,
    chainId: row.session.chainId,
  };
}

export function hasRole(user: SessionUser | null, role: Role): boolean {
  return Boolean(user?.roles.includes(role));
}
