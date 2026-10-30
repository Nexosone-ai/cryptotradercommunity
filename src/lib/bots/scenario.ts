import Decimal from "decimal.js";
import { z } from "zod";

/**
 * Staged scenario of a signal (webhook) bot, e.g. a sequential recovery strategy.
 *
 * The strategy logic lives in the operator's own script (TradingView Pine Script):
 * it decides when to enter, which stage it is on, when to take profit and when to
 * stop. The platform only sizes each order from the stage the signal names and
 * keeps the stop loss on Hyperliquid. Subscribers set a strategy capital; stage n
 * uses `stages[n-1]` % of it as margin, at the bot's max leverage.
 */
export const MAX_STAGES = 10;

export const scenarioSchema = z.object({
  /** Margin per stage, % of the subscriber's strategy capital, in order. */
  stages: z.array(z.number().positive().max(100)).min(1).max(MAX_STAGES),
  /** When the script enters (e.g. "Long ETH on the next hourly candle"). */
  entry: z.string().trim().min(10).max(1000),
  /** When the script takes profit. */
  takeProfit: z.string().trim().min(10).max(1000),
  /** What happens after the last stage's stop loss. */
  afterLastStage: z.string().trim().min(10).max(1000),
});
export type Scenario = z.infer<typeof scenarioSchema>;

/** Position size (USDC notional) of one stage: capital × stage % (margin) × leverage. */
export function stageNotionalUsd(capitalUsd: Decimal.Value, stagePct: number, leverage: number): Decimal {
  return new Decimal(capitalUsd).mul(stagePct).div(100).mul(leverage);
}

/** Smallest and largest strategy capital a subscriber can set: every stage must be ≥ the minimum order and ≤ the bot's max order. */
export function capitalRange(stages: number[], leverage: number, minOrderUsd: number, maxOrderUsd: number): { min: number; max: number } {
  const lo = Math.min(...stages);
  const hi = Math.max(...stages);
  return {
    min: new Decimal(minOrderUsd).div(new Decimal(lo).div(100).mul(leverage)).ceil().toNumber(),
    max: new Decimal(maxOrderUsd).div(new Decimal(hi).div(100).mul(leverage)).floor().toNumber(),
  };
}

export interface ScenarioRow {
  stage: number;
  pct: number;
  margin: Decimal;
  notional: Decimal;
  /** Loss if this stage's stop triggers (before fees and funding). */
  loss: Decimal;
  /** Total loss if every stage up to this one stops out. */
  cumulativeLoss: Decimal;
  /** Margin used by all stages up to this one. */
  cumulativeMargin: Decimal;
}

/** The scenario at a given capital: one row per stage, as if each stage up to it stopped out. Display only. */
export function scenarioRows(stages: number[], capitalUsd: Decimal.Value, leverage: number, stopLossPct: number): ScenarioRow[] {
  let cumulativeLoss = new Decimal(0);
  let cumulativeMargin = new Decimal(0);
  return stages.map((pct, i) => {
    const margin = new Decimal(capitalUsd).mul(pct).div(100);
    const notional = margin.mul(leverage);
    const loss = notional.mul(stopLossPct).div(100);
    cumulativeLoss = cumulativeLoss.plus(loss);
    cumulativeMargin = cumulativeMargin.plus(margin);
    return { stage: i + 1, pct, margin, notional, loss, cumulativeLoss, cumulativeMargin };
  });
}

/** Stage sizes grow after a loss (recovery / martingale-like sizing). */
export const isRecoverySizing = (stages: number[]) => stages.some((p, i) => i > 0 && p > stages[i - 1]);
