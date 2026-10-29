import { eq } from "drizzle-orm";
import { after } from "next/server";
import { apiContext } from "@/lib/api";
import type { BotConfig } from "@/lib/bots/schema";
import { bots } from "@/lib/db/schema";
import { engineAvailability, executeSignal } from "@/lib/engine/execute";
import { findSignal, normalizeCoin, parseAction, recordSignal, webhookBodySchema, webhookTokenMatches } from "@/lib/engine/signals";
import { ApiError, badRequest, handler, json, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

// Orders for all subscribers run after the response, within this budget.
export const maxDuration = 60;

/**
 * Signal webhook for WEBHOOK_SIGNAL bots (e.g. a TradingView alert).
 * Authenticated by the bot's token in the JSON body; no session or Origin.
 * Answers 202 at once and places subscriber orders after the response.
 */
export const POST = handler(async (req: Request, ctx: RouteContext<"/api/bots/[id]/signal">) => {
  const { id } = await ctx.params;
  const { db, hl } = await apiContext();
  await rateLimit(db, `signal:${id}`, 30, 60_000);
  const parsed = webhookBodySchema.safeParse(await readJson(req));
  if (!parsed.success) throw badRequest("INVALID_SIGNAL", 'Expected JSON like {"token":"…","action":"long|short|close","coin":"BTC"}.');
  const [bot] = await db.select().from(bots).where(eq(bots.id, id)).limit(1);
  // Same answer for an unknown bot and a wrong token.
  if (!bot || !webhookTokenMatches(parsed.data.token, bot.webhookSecretHash)) throw new ApiError(401, "INVALID_TOKEN", "Unknown bot or invalid token.");
  if ((bot.config as BotConfig).executionMode !== "WEBHOOK_SIGNAL") throw new ApiError(409, "NOT_WEBHOOK_BOT", "This bot doesn't accept external signals.");
  const action = parseAction(parsed.data.action);
  if (!action) throw badRequest("INVALID_ACTION", "action must be one of long, short, close (or buy, sell, flat, exit).");
  const coin = normalizeCoin(parsed.data.coin);
  const dedupeKey = parsed.data.id ? `id:${parsed.data.id}` : `${action}:${coin}:${Math.floor(Date.now() / 60_000)}`;
  const signal = await recordSignal(db, {
    botId: bot.id,
    network: hl.network,
    source: "WEBHOOK",
    action,
    coin,
    dedupeKey,
    payload: { action: parsed.data.action, coin: parsed.data.coin, id: parsed.data.id ?? null },
  });
  if (!signal) {
    const existing = await findSignal(db, bot.id, hl.network, dedupeKey);
    return json({ duplicate: true, signalId: existing?.id ?? null, status: existing?.status ?? null });
  }
  const engine = engineAvailability();
  after(() => executeSignal(db, hl, signal.id));
  return json({ signalId: signal.id, action, coin, engine: engine.enabled ? "on" : `off: ${engine.reason}` }, { status: 202 });
});
