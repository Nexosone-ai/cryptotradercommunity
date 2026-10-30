import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assessBotRisk } from "@/lib/bots/risk";
import { botConfigSchema } from "@/lib/bots/schema";
import { formatPerpPrice, formatPerpSize, newCloid } from "@/lib/hyperliquid/format";
import { computeMetrics } from "@/lib/performance/metrics";
import { decryptAgentKey, encryptSecret, decryptSecret, generateAgent } from "@/lib/trading/agent-keys";
import { validBotInput } from "../helpers/db";

describe("Hyperliquid tick rules", () => {
  it("rounds prices to 5 significant figures and (6 - szDecimals) decimals", () => {
    expect(formatPerpPrice("84123.456", 5)).toBe("84123");
    expect(formatPerpPrice("123456.7", 5)).toBe("123457");
    expect(formatPerpPrice("2401.987", 4)).toBe("2402");
    expect(formatPerpPrice("0.0123456", 0)).toBe("0.012346");
    expect(formatPerpPrice("1.234567", 2)).toBe("1.2346");
  });
  it("rounds sizes down to szDecimals and rejects zero", () => {
    expect(formatPerpSize("0.0029", 3)).toBe("0.002");
    expect(() => formatPerpSize("0.0004", 3)).toThrow();
  });
  it("creates 128-bit cloids", () => {
    const a = newCloid();
    expect(a).toMatch(/^0x[0-9a-f]{32}$/);
    expect(newCloid()).not.toBe(a);
  });
});

describe("performance metrics", () => {
  const fill = (day: number, pnl: string) => ({
    time: new Date(Date.UTC(2026, 0, 1 + day)),
    closedPnl: pnl,
    fee: "0.1",
    builderFee: "0.02",
    price: "100",
    size: "1",
  });

  it("reports insufficient data instead of a return figure", () => {
    const m = computeMetrics([fill(0, "5"), fill(1, "-2")], new Date(Date.UTC(2026, 0, 3)));
    expect(m.verification).toBe("INSUFFICIENT_DATA");
    expect(m.roi).toBeNull();
  });

  it("verifies after enough closing trades and days; computes MDD and win rate", () => {
    const rows = Array.from({ length: 24 }, (_, i) => fill(i, i % 3 === 0 ? "-4" : "3"));
    const m = computeMetrics(rows, new Date(Date.UTC(2026, 1, 1)));
    expect(m.verification).toBe("VERIFIED_LIVE");
    expect(m.closingTrades).toBe(24);
    expect(m.winRate).toBe("66.7");
    expect(Number(m.maxDrawdownUsd)).toBeGreaterThan(0);
    expect(m.feesUsd).toBe("2.8800");
  });
});

describe("agent key encryption", () => {
  it("round-trips and binds the key to its address", () => {
    process.env.AGENT_KEY_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    const agent = generateAgent();
    expect(agent.encryptedKey).not.toMatch(/^0x/);
    const pk = decryptAgentKey(agent.encryptedKey, agent.address);
    expect(pk).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => decryptAgentKey(agent.encryptedKey, "0x0000000000000000000000000000000000000001")).toThrow();
    const sealed = encryptSecret("hello", "aad");
    // Flip one byte of the ciphertext itself (not just base64 padding bits).
    const [iv, tag, data] = sealed.split(".");
    const bytes = Buffer.from(data, "base64");
    bytes[0] ^= 0xff;
    const tampered = [iv, tag, bytes.toString("base64")].join(".");
    expect(decryptSecret(sealed, "aad")).toBe("hello");
    expect(() => decryptSecret(tampered, "aad")).toThrow();
    delete process.env.AGENT_KEY_ENCRYPTION_KEY;
    expect(() => generateAgent()).toThrow(/not configured/);
  });
});

describe("bot config validation and risk screen", () => {
  it("requires consents, kill switch and consistent limits", () => {
    expect(botConfigSchema.safeParse(validBotInput()).success).toBe(true);
    expect(botConfigSchema.safeParse(validBotInput({ consents: { terms: true, risk: false, performancePolicy: true } })).success).toBe(false);
    expect(botConfigSchema.safeParse(validBotInput({ leverageMin: 10, leverageMax: 2 })).success).toBe(false);
    expect(botConfigSchema.safeParse(validBotInput({ markets: ["BTC-SPOT"] })).success).toBe(false);
    expect(botConfigSchema.safeParse(validBotInput({ feeTenthsBp: 101 })).success).toBe(false);
  });
  it("flags martingale and high leverage; blocks fees above the platform cap", () => {
    const c = botConfigSchema.parse(
      validBotInput({ strategyType: "MARTINGALE", leverageMax: 30, risk: { ...validBotInput().risk, maxLeverage: 30 }, feeTenthsBp: 60 }),
    );
    const r = assessBotRisk(c, 50);
    expect(r.level).toBe("EXTREME");
    expect(r.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["MARTINGALE", "HIGH_LEVERAGE", "FEE_ABOVE_PLATFORM_CAP"]));
  });
  it("a stop loss wider than the move that uses up the margin at max leverage is high risk (e.g. 20% at 25x)", () => {
    const at = (maxLeverage: number, stopLossPct: number) =>
      assessBotRisk(botConfigSchema.parse(validBotInput({ leverageMax: maxLeverage, risk: { ...validBotInput().risk, maxLeverage, stopLossPct } })), 50);
    const martin = at(25, 20);
    expect(martin.level).toBe("HIGH");
    const finding = martin.findings.find((f) => f.code === "STOP_BEYOND_MARGIN")!;
    expect(finding.severity).toBe("WARN");
    expect(finding.message).toContain("At 25x a 4% move already uses up the position's margin (a 20% stop loses 500% of it)");
    expect(at(5, 5).findings.map((f) => f.code)).not.toContain("STOP_BEYOND_MARGIN"); // 5% < 20%
    expect(at(5, 5).level).toBe("LOW");
  });
});
