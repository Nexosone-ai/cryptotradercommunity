import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { depositProblem, HL_DEPOSIT, MIN_DEPOSIT_USDC } from "@/lib/hl-deposit";

describe("Hyperliquid deposit", () => {
  it("uses the documented Arbitrum bridge and native USDC", () => {
    expect(HL_DEPOSIT.mainnet).toEqual({
      chainId: 42161,
      usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      bridge: "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7",
      usdcSymbol: "USDC",
    });
    expect(HL_DEPOSIT.testnet.chainId).toBe(421614);
    expect(MIN_DEPOSIT_USDC.toFixed()).toBe("5");
  });

  it("refuses amounts below 5 USDC (they would be lost), above the balance, or malformed", () => {
    const bal = new Decimal("109.6");
    expect(depositProblem("4.999999", bal)).toMatch(/minimum deposit is 5 USDC/);
    expect(depositProblem("0", bal)).toMatch(/Enter an amount/);
    expect(depositProblem("abc", bal)).toMatch(/Enter an amount/);
    expect(depositProblem("5.0000001", bal)).toMatch(/6 decimal places/);
    expect(depositProblem("109.61", bal)).toMatch(/more USDC than this wallet holds/);
    expect(depositProblem("5", bal)).toBeNull();
    expect(depositProblem("109.6", bal)).toBeNull();
    expect(depositProblem("50", null)).toBeNull(); // balance unknown: MetaMask/chain still refuse overspending
  });
});
