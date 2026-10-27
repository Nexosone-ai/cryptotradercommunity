import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectSecrets, normalizeSource, pineMeta, sourceInputSchema } from "@/lib/bots/source";

const PINE = readFileSync(path.join(__dirname, "../fixtures/rsi-div-ltf-delta.pine"), "utf8");

describe("strategy source attachment", () => {
  it("reads the header of a real Pine Script v6 indicator", () => {
    expect(pineMeta(PINE)).toEqual({
      version: 6,
      kind: "indicator",
      title: "RSI DIV + LTF DELTA + EMA FILTER V11",
      inputs: 12,
      alerts: 2,
      orders: 0,
    });
    expect(sourceInputSchema.parse({ language: "PINESCRIPT", code: PINE })).toMatchObject({ visibility: "PRIVATE" });
  });

  it("detects strategy() scripts and their order calls", () => {
    const s = `//@version=5\nstrategy('Breakout', overlay=true)\nlen = input.int(20)\nif ta.crossover(close, ta.highest(high, len)[1])\n    strategy.entry("L", strategy.long)\nstrategy.exit("x", "L", stop=low)`;
    expect(pineMeta(s)).toMatchObject({ version: 5, kind: "strategy", title: "Breakout", inputs: 1, orders: 2 });
  });

  it("refuses code containing keys or seeds", () => {
    const key = "0x" + "ab".repeat(32);
    expect(detectSecrets(`PRIVATE_KEY = "${key}"`)).toContain("개인키(64자리 16진수)");
    expect(detectSecrets(`api_secret = "abcdefghijklmnopqrstuvwx"`).length).toBeGreaterThan(0);
    expect(detectSecrets(PINE)).toEqual([]);
    const r = sourceInputSchema.safeParse({ language: "PYTHON", code: `import ccxt\nkey = "${key}"\nprint(key)` });
    expect(r.success).toBe(false);
  });

  it("rejects Pine without a declaration, oversized or binary input", () => {
    expect(sourceInputSchema.safeParse({ language: "PINESCRIPT", code: "rsi = ta.rsi(close, 14)\nplot(rsi)\n" }).success).toBe(false);
    expect(sourceInputSchema.safeParse({ language: "OTHER", code: "x".repeat(200_001) }).success).toBe(false);
    expect(sourceInputSchema.safeParse({ language: "OTHER", code: "abc\u0000defghijklmnopqrstuvwxyz" }).success).toBe(false);
  });

  it("normalizes line endings so the same script hashes the same", () => {
    expect(normalizeSource("a  \r\nb\r\n\r\n")).toBe("a\nb\n");
    expect(normalizeSource(PINE.replace(/\n/g, "\r\n"))).toBe(normalizeSource(PINE));
  });
});
