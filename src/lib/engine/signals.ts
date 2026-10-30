import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { botSignals } from "../db/schema";

/** Target position a signal asks for. Signals are idempotent: repeating LONG while long does nothing. */
export type TargetAction = "LONG" | "SHORT" | "FLAT";

const ACTIONS: Record<string, TargetAction> = {
  long: "LONG",
  buy: "LONG",
  short: "SHORT",
  sell: "SHORT",
  flat: "FLAT",
  close: "FLAT",
  exit: "FLAT",
};

export function parseAction(raw: string): TargetAction | null {
  return ACTIONS[raw.trim().toLowerCase()] ?? null;
}

/**
 * Accepts the coin the way TradingView and people write it and returns the
 * Hyperliquid perp name: "BTC", "BTC-PERP", "BTCUSDT.P", "BINANCE:BTCUSDT" → "BTC".
 */
export function normalizeCoin(raw: string): string {
  let c = raw.trim().toUpperCase();
  c = c.includes(":") ? c.slice(c.lastIndexOf(":") + 1) : c;
  c = c.replace(/\.P$/, "").replace(/-?PERP$/, "");
  const quote = c.match(/^(.+?)(USDT|USDC|USD)$/);
  return quote ? quote[1] : c;
}

/** Body TradingView (or any client) POSTs to /api/bots/{id}/signal. TradingView can't set headers, so the token is in the body. */
export const webhookBodySchema = z.object({
  token: z.string().min(20).max(200),
  action: z.string().min(1).max(20),
  coin: z.string().min(1).max(40),
  /** Optional idempotency key, e.g. "{{timenow}}". */
  id: z.string().max(100).optional(),
});

export function newWebhookToken(): string {
  return `ctc_${randomBytes(24).toString("base64url")}`;
}

export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function webhookTokenMatches(token: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashWebhookToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Stores a signal once per (bot, network, dedupeKey). Returns null when it was already received. */
export async function recordSignal(
  db: DbOrTx,
  input: {
    botId: string;
    network: "testnet" | "mainnet";
    source: "WEBHOOK" | "TEMPLATE" | "COPY";
    action: TargetAction;
    coin: string;
    dedupeKey: string;
    payload?: unknown;
  },
) {
  const [row] = await db
    .insert(botSignals)
    .values({ ...input, payload: input.payload ?? null, status: "RECEIVED" })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function findSignal(db: DbOrTx, botId: string, network: "testnet" | "mainnet", dedupeKey: string) {
  const [row] = await db
    .select()
    .from(botSignals)
    .where(and(eq(botSignals.botId, botId), eq(botSignals.network, network), eq(botSignals.dedupeKey, dedupeKey)))
    .limit(1);
  return row ?? null;
}
