import { describe, expect, it } from "vitest";
import { isUnifiedMode, tradingBalance } from "@/lib/hyperliquid/balance";

describe("Hyperliquid trading balance", () => {
  it("unified and portfolio-margin accounts use the spot USDC balance (perps reads 0 there)", () => {
    const unified = { perpsValue: "0.0", perpsWithdrawable: "0.0", spotUsdcTotal: "48.75", spotUsdcHold: "0.0" };
    expect(tradingBalance({ mode: "unifiedAccount", ...unified })).toEqual({ value: "48.75", available: "48.75", unified: true });
    expect(tradingBalance({ mode: "portfolioMargin", ...unified, spotUsdcHold: "10" })).toEqual({ value: "48.75", available: "38.75", unified: true });
    expect(isUnifiedMode("unifiedAccount")).toBe(true);
    expect(isUnifiedMode("default")).toBe(false);
  });

  it("standard accounts use the perps account; unknown mode is treated as standard", () => {
    const standard = { perpsValue: "120.5", perpsWithdrawable: "100", spotUsdcTotal: "7", spotUsdcHold: "0" };
    expect(tradingBalance({ mode: "default", ...standard })).toEqual({ value: "120.5", available: "100", unified: false });
    expect(tradingBalance({ mode: null, ...standard }).value).toBe("120.5");
    expect(tradingBalance({ mode: "default" }).value).toBe("0");
  });
});
