import { describe, expect, it } from "vitest";
import { applyDirection } from "@/lib/engine/execute";
import { hashWebhookToken, newWebhookToken, normalizeCoin, parseAction, webhookTokenMatches } from "@/lib/engine/signals";
import { crossover, ema } from "@/lib/engine/trend";

describe("signal parsing", () => {
  it("maps TradingView and plain words to a target position", () => {
    expect(["long", "BUY", " Long "].map(parseAction)).toEqual(["LONG", "LONG", "LONG"]);
    expect(["short", "sell"].map(parseAction)).toEqual(["SHORT", "SHORT"]);
    expect(["flat", "close", "EXIT"].map(parseAction)).toEqual(["FLAT", "FLAT", "FLAT"]);
    expect(parseAction("hold")).toBeNull();
  });

  it("normalizes coin names to Hyperliquid perps", () => {
    expect(["BTC", "btc", "BTC-PERP", "BTCUSDT.P", "BINANCE:BTCUSDT", "BTCUSD", "HYPERLIQUID:BTCUSDC.P"].map(normalizeCoin)).toEqual(Array(7).fill("BTC"));
    expect(normalizeCoin("ETHPERP")).toBe("ETH");
    expect(normalizeCoin("USDT")).toBe("USDT");
  });

  it("webhook tokens are random and compared by hash", () => {
    const a = newWebhookToken();
    expect(a).toMatch(/^ctc_[A-Za-z0-9_-]{32}$/);
    expect(newWebhookToken()).not.toBe(a);
    expect(webhookTokenMatches(a, hashWebhookToken(a))).toBe(true);
    expect(webhookTokenMatches(a + "x", hashWebhookToken(a))).toBe(false);
    expect(webhookTokenMatches(a, null)).toBe(false);
  });

  it("bot direction limits the target", () => {
    expect(applyDirection("SHORT", "LONG")).toBe("FLAT");
    expect(applyDirection("LONG", "SHORT")).toBe("FLAT");
    expect(applyDirection("SHORT", "BOTH")).toBe("SHORT");
    expect(applyDirection("FLAT", "LONG")).toBe("FLAT");
  });
});

describe("trend template", () => {
  it("ema follows the series with the usual smoothing", () => {
    expect(ema([10, 10, 10], 3)).toEqual([10, 10, 10]);
    expect(ema([0, 10], 3)[1]).toBe(5); // k = 2 / (3 + 1)
  });

  it("detects a crossover only on the last closed candle", () => {
    const falling = Array.from({ length: 40 }, (_, i) => 100 - i);
    expect(crossover([...falling, 150])).toBe("LONG");
    const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(crossover([...rising, 50])).toBe("SHORT");
    expect(crossover(rising)).toBeNull();
    expect(crossover([1, 2, 3])).toBeNull();
  });
});
