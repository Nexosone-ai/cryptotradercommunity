import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getConfig } from "../config";
import type { Db } from "../db/client";
import { bots, botSubscriptions } from "../db/schema";
import { getBotMetrics, type BotMetrics } from "../performance/metrics";
import { PUBLIC_STATUSES } from "./service";
import { assessBotRisk } from "./risk";
import type { BotConfig } from "./schema";

export interface BotListFilter {
  q?: string;
  strategy?: string;
  market?: string;
  verifiedOnly?: boolean;
  maxFeeTenthsBp?: number;
  sort?: "newest" | "risk" | "fee" | "pnl" | "drawdown";
}

export interface PublicBotCard {
  id: string;
  slug: string;
  name: string;
  summary: string;
  status: string;
  strategyType: string;
  ownerWalletAddress: string;
  feeTenthsBp: number;
  riskLevel: string;
  markets: string[];
  maxLeverage: number;
  liveSince: string | null;
  subscribers: number;
  metrics: BotMetrics;
}

const RISK_ORDER: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, EXTREME: 3 };

export async function listPublicBots(db: Db, f: BotListFilter = {}): Promise<PublicBotCard[]> {
  const rows = await db
    .select({
      bot: bots,
      subscribers: sql<number>`(select count(*) from ${botSubscriptions} s where s.bot_id = ${bots.id} and s.status = 'ACTIVE')`,
    })
    .from(bots)
    .where(
      and(
        inArray(bots.status, PUBLIC_STATUSES),
        f.q ? or(ilike(bots.name, `%${f.q}%`), ilike(bots.summary, `%${f.q}%`), ilike(bots.ownerWalletAddress, `%${f.q}%`)) : undefined,
        f.strategy ? eq(bots.strategyType, f.strategy) : undefined,
        f.maxFeeTenthsBp !== undefined ? sql`${bots.feeTenthsBp} <= ${f.maxFeeTenthsBp}` : undefined,
        f.market ? sql`${bots.config}->'markets' ? ${f.market}` : undefined,
      ),
    )
    .orderBy(desc(bots.liveSince))
    .limit(200);

  let cards: PublicBotCard[] = await Promise.all(
    rows.map(async ({ bot, subscribers }) => {
      const config = bot.config as BotConfig;
      return {
        id: bot.id,
        slug: bot.slug,
        name: bot.name,
        summary: bot.summary,
        status: bot.status,
        strategyType: bot.strategyType,
        ownerWalletAddress: bot.ownerWalletAddress,
        feeTenthsBp: bot.feeTenthsBp,
        // Rated with the current rules, so a stricter rule shows on bots registered before it.
        riskLevel: assessBotRisk(config, getConfig().platformMaxFeeTenthsBp).level,
        markets: config.markets,
        maxLeverage: config.risk.maxLeverage,
        liveSince: bot.liveSince?.toISOString() ?? null,
        subscribers: Number(subscribers),
        metrics: await getBotMetrics(db, bot.id),
      };
    }),
  );
  if (f.verifiedOnly) cards = cards.filter((c) => c.metrics.verification === "VERIFIED_LIVE");

  const verifiedFirst = (a: PublicBotCard, b: PublicBotCard) =>
    Number(b.metrics.verification === "VERIFIED_LIVE") - Number(a.metrics.verification === "VERIFIED_LIVE");
  switch (f.sort) {
    case "risk":
      cards.sort((a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel]);
      break;
    case "fee":
      cards.sort((a, b) => a.feeTenthsBp - b.feeTenthsBp);
      break;
    case "pnl":
      // Only verified bots are ranked by performance; the rest follow unranked.
      cards.sort((a, b) => verifiedFirst(a, b) || Number(b.metrics.netPnlUsd) - Number(a.metrics.netPnlUsd));
      break;
    case "drawdown":
      cards.sort((a, b) => verifiedFirst(a, b) || Number(a.metrics.maxDrawdownUsd) - Number(b.metrics.maxDrawdownUsd));
      break;
  }
  return cards;
}

export async function newestPublicBots(db: Db, limit = 6) {
  return db
    .select()
    .from(bots)
    .where(inArray(bots.status, PUBLIC_STATUSES))
    .orderBy(desc(bots.liveSince))
    .limit(limit);
}
