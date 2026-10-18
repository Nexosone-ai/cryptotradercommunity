import "server-only";
import { cookies } from "next/headers";
import { getDb } from "../db/client";
import { forbidden, unauthorized } from "../http";
import { loadSessionUser, SESSION_COOKIE, type Role, type SessionUser } from "./session";

/** Current signed-in user from the session cookie, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return loadSessionUser(await getDb(), token);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  return user;
}

/** Server-side role check. Hiding a link is never the access control. */
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.roles.includes(role)) throw forbidden();
  return user;
}
