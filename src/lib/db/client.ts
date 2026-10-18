import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A transaction handle has the same query API as the database. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

/**
 * Creates a database handle.
 * - `url` set → Postgres via postgres-js (production; migrations run separately).
 * - otherwise → embedded PGlite (dev/tests), migrated on open.
 *   `dataDir` "memory" gives a throwaway in-memory database.
 */
export async function createDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  if (opts.url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(opts.url, { max: 10, prepare: false });
    return drizzle(client, { schema }) as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = opts.dataDir ?? process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (dir !== "memory") mkdirSync(path.dirname(dir), { recursive: true });
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as Db;
}

const globalForDb = globalThis as unknown as { __ctcDb?: Promise<Db> };

/** Process-wide database handle (survives dev hot reloads). */
export function getDb(): Promise<Db> {
  if (!globalForDb.__ctcDb) {
    globalForDb.__ctcDb = createDb({ url: process.env.DATABASE_URL || undefined }).catch((err) => {
      globalForDb.__ctcDb = undefined;
      throw err;
    });
  }
  return globalForDb.__ctcDb;
}

/** Test hook: replace the process-wide handle. */
export function setDbForTests(db: Db | undefined) {
  globalForDb.__ctcDb = db ? Promise.resolve(db) : undefined;
}
