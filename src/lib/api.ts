import "server-only";
import { getCurrentUser } from "./auth/current";
import type { Role, SessionUser } from "./auth/session";
import { getConfig } from "./config";
import { getDb, type Db } from "./db/client";
import { forbidden, unauthorized, assertSameOrigin } from "./http";
import { getHlGateway } from "./hyperliquid/gateway";
import { rateLimit } from "./rate-limit";

/** Market data only: no database needed, so it works even if the DB is down. */
export function marketContext() {
  const cfg = getConfig();
  return { cfg, hl: getHlGateway(cfg.network) };
}

export async function apiContext() {
  const db = await getDb();
  const cfg = getConfig();
  return { db, cfg, hl: getHlGateway(cfg.network) };
}

/** Auth + same-origin + per-user rate limit for state-changing endpoints. */
export async function mutationContext(
  req: Request,
  opts: { role?: Role; limit?: number; windowMs?: number; bucket: string },
): Promise<Awaited<ReturnType<typeof apiContext>> & { user: SessionUser }> {
  assertSameOrigin(req);
  const ctx = await apiContext();
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  if (opts.role && !user.roles.includes(opts.role)) throw forbidden();
  await rateLimit(ctx.db, `${opts.bucket}:${user.id}`, opts.limit ?? 30, opts.windowMs ?? 60_000);
  return { ...ctx, user };
}

export async function readContext(opts: { role?: Role } = {}) {
  const ctx = await apiContext();
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  if (opts.role && !user.roles.includes(opts.role)) throw forbidden();
  return { ...ctx, user };
}

export type { Db };
