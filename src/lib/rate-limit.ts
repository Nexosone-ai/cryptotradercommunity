import { sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { ApiError } from "./http";
import { bi } from "./i18n";

/**
 * Fixed-window rate limiter stored in Postgres so it holds across serverless
 * instances. (Redis is the production upgrade; see docs/DEPLOYMENT.md.)
 */
export async function rateLimit(db: Db, key: string, limit: number, windowMs: number) {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const result = await db.execute<{ count: number }>(sql`
    insert into rate_limit_buckets (key, window_start, count)
    values (${key}, ${windowStart.toISOString()}, 1)
    on conflict (key) do update set
      count = case when rate_limit_buckets.window_start = excluded.window_start
                   then rate_limit_buckets.count + 1 else 1 end,
      window_start = excluded.window_start
    returning count`);
  const rows = (Array.isArray(result) ? result : (result as { rows: { count: number }[] }).rows) as {
    count: number;
  }[];
  const count = Number(rows[0]?.count ?? 0);
  if (count > limit) {
    throw new ApiError(429, "RATE_LIMITED", bi("Too many requests. Please try again shortly.", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."));
  }
}
