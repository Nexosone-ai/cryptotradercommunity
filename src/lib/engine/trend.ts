import { eq } from "drizzle-orm";
import type { BotConfig } from "../bots/schema";
import type { Db } from "../db/client";
import { bots } from "../db/schema";
import type { HlGateway } from "../hyperliquid/gateway";
import { engineAvailability, executeSignal } from "./execute";
import { recordSignal, type TargetAction } from "./signals";

/**
 * Platform template for Trend Following bots: EMA(9) / EMA(21) crossover on
 * closed candles of the bot's timeframe. A cross up targets LONG, a cross down
 * targets SHORT (a LONG-only bot closes instead; see applyDirection).
 * The signal key is the candle time, so each crossover acts once.
 */
export const TREND_TEMPLATE = { fast: 9, slow: 21 } as const;

const INTERVAL_MS: Record<BotConfig["timeframe"], number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "4h": 4 * 3_600_000,
  "1d": 86_400_000,
};

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

/** Crossover on the last closed candle, or null. Closes are oldest → newest. */
export function crossover(closes: number[], fast = TREND_TEMPLATE.fast, slow = TREND_TEMPLATE.slow): TargetAction | null {
  if (closes.length < slow + 2) return null;
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const n = closes.length - 1;
  if (f[n - 1] <= s[n - 1] && f[n] > s[n]) return "LONG";
  if (f[n - 1] >= s[n - 1] && f[n] < s[n]) return "SHORT";
  return null;
}

export function usesTrendTemplate(config: BotConfig): boolean {
  return config.executionMode === "PLATFORM_TEMPLATE" && config.strategyType === "TREND_FOLLOWING";
}

/** One pass over every LIVE trend-template bot. Returns the signals it emitted. */
export async function runTrendTick(db: Db, hl: HlGateway, now = Date.now()) {
  if (!engineAvailability().enabled) return [];
  const live = await db.select().from(bots).where(eq(bots.status, "LIVE"));
  const emitted: { botId: string; coin: string; action: TargetAction }[] = [];
  for (const bot of live) {
    const config = bot.config as BotConfig;
    if (!usesTrendTemplate(config)) continue;
    const interval = INTERVAL_MS[config.timeframe];
    for (const market of config.markets) {
      const coin = market.replace(/-PERP$/, "");
      try {
        const raw = (await hl.candles(coin, config.timeframe, now - interval * (TREND_TEMPLATE.slow * 4 + 5))) as { t: number; T: number; c: string }[];
        const closed = raw.filter((c) => c.T < now).sort((a, b) => a.t - b.t);
        const action = crossover(closed.map((c) => Number(c.c)));
        if (!action) continue;
        const last = closed[closed.length - 1];
        const signal = await recordSignal(db, {
          botId: bot.id,
          network: hl.network,
          source: "TEMPLATE",
          action,
          coin,
          dedupeKey: `ema${TREND_TEMPLATE.fast}-${TREND_TEMPLATE.slow}:${coin}:${config.timeframe}:${last.t}`,
          payload: { template: "EMA_CROSS", fast: TREND_TEMPLATE.fast, slow: TREND_TEMPLATE.slow, candleTime: last.t, close: last.c },
        });
        if (!signal) continue;
        emitted.push({ botId: bot.id, coin, action });
        await executeSignal(db, hl, signal.id);
      } catch (err) {
        console.error("[engine] trend tick failed", bot.slug, coin, err instanceof Error ? err.message : err);
      }
    }
  }
  return emitted;
}
