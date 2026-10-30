import { and, eq } from "drizzle-orm";
import { writeAudit } from "../audit";
import type { SessionUser } from "../auth/session";
import { capitalRange } from "../bots/scenario";
import { isCopyBot, type BotConfig } from "../bots/schema";
import type { Db } from "../db/client";
import { botSubscriptions, bots } from "../db/schema";
import { badRequest, conflict, forbidden, notFound } from "../http";
import { hashWebhookToken, newWebhookToken } from "./signals";

/** Owner creates (or replaces) the bot's signal-webhook token. The plain token is returned once. */
export async function rotateWebhookToken(db: Db, user: SessionUser, botId: string) {
  const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
  if (!bot) throw notFound("Bot not found.");
  if (bot.ownerUserId !== user.id) throw forbidden("Only the bot owner can manage its signal webhook.");
  if ((bot.config as BotConfig).executionMode !== "WEBHOOK_SIGNAL") {
    throw conflict("NOT_WEBHOOK_BOT", "This bot doesn't use external signals. Change its execution mode to External signal webhook (needs review) first.");
  }
  const token = newWebhookToken();
  await db.update(bots).set({ webhookSecretHash: hashWebhookToken(token) }).where(eq(bots.id, bot.id));
  await writeAudit(db, {
    actorUserId: user.id,
    actorWallet: user.walletAddress,
    action: bot.webhookSecretHash ? "BOT_WEBHOOK_TOKEN_ROTATED" : "BOT_WEBHOOK_TOKEN_CREATED",
    targetType: "bot",
    targetId: bot.id,
  });
  return token;
}

export const MIN_ORDER_USD = 11; // Hyperliquid's minimum is 10 USDC notional; a little headroom for price moves.

/** Subscriber sets the USDC amount the engine opens per signal (capped by the bot's max order). */
export async function setOrderUsd(db: Db, user: SessionUser, botId: string, network: "testnet" | "mainnet", orderUsd: number) {
  const [row] = await db
    .select({ sub: botSubscriptions, bot: bots })
    .from(botSubscriptions)
    .innerJoin(bots, eq(bots.id, botSubscriptions.botId))
    .where(and(eq(botSubscriptions.botId, botId), eq(botSubscriptions.userId, user.id), eq(botSubscriptions.network, network)))
    .limit(1);
  if (!row) throw notFound("You aren't subscribed to this bot.");
  validateOrderUsd(orderUsd, row.bot.config as BotConfig);
  const [saved] = await db.update(botSubscriptions).set({ orderUsd }).where(eq(botSubscriptions.id, row.sub.id)).returning();
  return saved;
}

/** Copy-trading followers set an allocation instead: the USDC that mirrors the leader's whole account. */
export const MIN_COPY_ALLOCATION_USD = 20;
export const MAX_COPY_ALLOCATION_USD = 1_000_000;

export function validateOrderUsd(orderUsd: number, config: BotConfig) {
  if (isCopyBot(config)) {
    if (!Number.isInteger(orderUsd) || orderUsd < MIN_COPY_ALLOCATION_USD || orderUsd > MAX_COPY_ALLOCATION_USD) {
      throw badRequest("ALLOCATION_INVALID", `The copy allocation must be a whole number of USDC between ${MIN_COPY_ALLOCATION_USD} and ${MAX_COPY_ALLOCATION_USD}.`);
    }
    return;
  }
  if (config.scenario) {
    // Staged scenario: the value is the strategy capital; each stage takes its % of it as margin.
    const { min, max } = capitalRange(config.scenario.stages, config.risk.maxLeverage, MIN_ORDER_USD, config.risk.maxOrderUsd);
    if (!Number.isInteger(orderUsd) || orderUsd < min || orderUsd > max) {
      throw badRequest(
        "CAPITAL_OUT_OF_RANGE",
        min > max
          ? "This bot's stages can't be sized within its max order; the owner needs to raise the max order or change the stages."
          : `The strategy capital must be a whole number of USDC between ${min} and ${max}, so every stage is at least ${MIN_ORDER_USD} USDC and at most this bot's max order (${config.risk.maxOrderUsd} USDC).`,
      );
    }
    return;
  }
  if (!Number.isInteger(orderUsd) || orderUsd < MIN_ORDER_USD) {
    throw badRequest("ORDER_USD_TOO_SMALL", `The amount per trade must be a whole number of at least ${MIN_ORDER_USD} USDC.`);
  }
  if (orderUsd > config.risk.maxOrderUsd) {
    throw badRequest("ORDER_USD_TOO_LARGE", `The amount per trade can't exceed this bot's max order of ${config.risk.maxOrderUsd} USDC.`);
  }
}
