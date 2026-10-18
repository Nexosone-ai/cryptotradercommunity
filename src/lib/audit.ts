import { createHash } from "node:crypto";
import { desc, sql } from "drizzle-orm";
import type { DbOrTx } from "./db/client";
import { adminAuditLogs } from "./db/schema";

const GENESIS = "0".repeat(64);

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

export interface AuditInput {
  actorUserId?: string | null;
  actorWallet?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

/**
 * Appends a hash-chained audit record. The table is append-only (DB trigger);
 * the chain makes silent edits detectable (verifyAuditChain).
 * A transaction-level advisory lock serializes writers so the chain stays linear.
 */
export async function writeAudit(db: DbOrTx, input: AuditInput) {
  await db.execute(sql`select pg_advisory_xact_lock(424242)`);
  const [last] = await db
    .select({ hash: adminAuditLogs.hash })
    .from(adminAuditLogs)
    .orderBy(desc(adminAuditLogs.seq))
    .limit(1);
  const prevHash = last?.hash ?? GENESIS;
  const createdAt = new Date();
  const body = {
    actorUserId: input.actorUserId ?? null,
    actorWallet: input.actorWallet ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    createdAt: createdAt.toISOString(),
  };
  const hash = createHash("sha256").update(prevHash + canonical(body)).digest("hex");
  await db.insert(adminAuditLogs).values({
    ...body,
    before: body.before as object | null,
    after: body.after as object | null,
    createdAt,
    prevHash,
    hash,
  });
  return hash;
}

/** Recomputes the chain; returns the first broken record id or null. */
export async function verifyAuditChain(db: DbOrTx): Promise<string | null> {
  const rows = await db.select().from(adminAuditLogs).orderBy(adminAuditLogs.seq);
  let prev = GENESIS;
  for (const r of rows) {
    const body = {
      actorUserId: r.actorUserId,
      actorWallet: r.actorWallet,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      before: r.before,
      after: r.after,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    };
    const expected = createHash("sha256").update(prev + canonical(body)).digest("hex");
    if (r.prevHash !== prev || r.hash !== expected) return r.id;
    prev = r.hash;
  }
  return null;
}
