import { describe, expect, it } from "vitest";
import { assessBotRisk } from "@/lib/bots/risk";
import { capitalRange, isRecoverySizing, scenarioRows, stageNotionalUsd } from "@/lib/bots/scenario";
import { botConfigSchema } from "@/lib/bots/schema";
import { validBotInput } from "../helpers/db";

const RECOVERY = { stages: [10, 10, 10, 20, 20, 20], entry: "Long ETH at the next hourly candle.", takeProfit: "Cycle net PnL reaches 20% of margin used.", afterLastStage: "Pause after the sixth stop loss for review." };
const staged = (overrides: Record<string, unknown> = {}) =>
  validBotInput({
    executionMode: "WEBHOOK_SIGNAL",
    strategyType: "MARTINGALE",
    markets: ["ETH-PERP"],
    direction: "LONG",
    leverageMax: 5,
    risk: { ...validBotInput().risk, maxLeverage: 5, stopLossPct: 4, maxOrderUsd: 1000, maxPositionUsd: 1000 },
    scenario: RECOVERY,
    ...overrides,
  });

describe("staged scenario", () => {
  it("sizes each stage as capital × stage % × leverage, and the worst case as every stage stopping out", () => {
    expect(stageNotionalUsd(1000, 10, 5).toFixed()).toBe("500");
    expect(stageNotionalUsd(1000, 20, 5).toFixed()).toBe("1000");
    const rows = scenarioRows(RECOVERY.stages, 1000, 5, 4); // −4% price = −20% of margin at 5x
    expect(rows.map((r) => r.loss.toFixed())).toEqual(["20", "20", "20", "40", "40", "40"]);
    expect(rows.at(-1)!.cumulativeLoss.toFixed()).toBe("180"); // 18% of capital
    expect(rows.at(-1)!.cumulativeMargin.toFixed()).toBe("900");
  });

  it("capital range keeps every stage between the minimum order and the bot's max order", () => {
    expect(capitalRange(RECOVERY.stages, 5, 11, 1000)).toEqual({ min: 22, max: 1000 });
  });

  it("is only for webhook bots, and the stages can't use more than 100% of the capital", () => {
    expect(botConfigSchema.safeParse(staged()).success).toBe(true);
    expect(botConfigSchema.safeParse(staged({ executionMode: "PLATFORM_TEMPLATE" })).success).toBe(false);
    expect(botConfigSchema.safeParse(staged({ scenario: { ...RECOVERY, stages: [50, 60] } })).success).toBe(false);
    expect(botConfigSchema.safeParse(staged({ scenario: { ...RECOVERY, entry: "short" } })).success).toBe(false);
  });

  it("growing stages are recovery sizing: high risk, with the worst case stated", () => {
    expect(isRecoverySizing(RECOVERY.stages)).toBe(true);
    expect(isRecoverySizing([20, 20, 10])).toBe(false);
    const r = assessBotRisk(botConfigSchema.parse(staged({ strategyType: "CUSTOM" })), 50);
    expect(r.level).toBe("HIGH");
    expect(r.findings.find((f) => f.code === "STAGED_SCENARIO")!.message).toContain("about 18% of the subscriber's strategy capital");
  });
});
