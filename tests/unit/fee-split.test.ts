import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { splitBuilderFee, type FeePolicyShares } from "@/lib/fees/split";
import { estimateFees, tenthsBpToPercentString } from "@/lib/fees/rates";
import { formatUsdcE8, parseUsdcE8 } from "@/lib/money";

const DEFAULT: FeePolicyShares = {
  botOwnerSharePpm: 700_000,
  platformShareOfPoolPpm: 200_000,
  tier1ShareOfPartnerPoolPpm: 600_000,
};
const usdc = (s: string) => parseUsdcE8(s).amount;

describe("builder fee split", () => {
  it("100 USDC → 70 / 6 / 14.4 / 9.6, total exactly 100", () => {
    const r = splitBuilderFee({
      revenueE8: usdc("100"),
      policy: DEFAULT,
      botOwnerUserId: "owner",
      tier1PartnerUserId: "B",
      tier2PartnerUserId: "A",
    });
    expect(formatUsdcE8(r.botOwner)).toBe("70.00");
    expect(formatUsdcE8(r.platformNet)).toBe("6.00");
    expect(formatUsdcE8(r.tier1)).toBe("14.40");
    expect(formatUsdcE8(r.tier2)).toBe("9.60");
    expect(r.remainder).toBe(0n);
    expect(r.botOwner + r.platformNet + r.tier1 + r.tier2 + r.remainder).toBe(usdc("100"));
    expect(r.lines).toContainEqual({ account: "PARTNER_PAYABLE", userId: "B", tier: 1, amountE8: usdc("14.4") });
    expect(r.lines).toContainEqual({ account: "PARTNER_PAYABLE", userId: "A", tier: 2, amountE8: usdc("9.6") });
  });

  it("missing referrers go to the unallocated reserve, not platform net", () => {
    const r = splitBuilderFee({
      revenueE8: usdc("100"),
      policy: DEFAULT,
      botOwnerUserId: "owner",
      tier1PartnerUserId: null,
      tier2PartnerUserId: null,
    });
    const platform = r.lines.filter((l) => l.account === "PLATFORM_NET_REVENUE").reduce((s, l) => s + l.amountE8, 0n);
    const reserve = r.lines.filter((l) => l.account === "UNALLOCATED_PARTNER_RESERVE").reduce((s, l) => s + l.amountE8, 0n);
    expect(formatUsdcE8(platform)).toBe("6.00");
    expect(formatUsdcE8(reserve)).toBe("24.00");
  });

  it("only tier 2 missing → 9.6 reserved", () => {
    const r = splitBuilderFee({ revenueE8: usdc("100"), policy: DEFAULT, botOwnerUserId: "o", tier1PartnerUserId: "B", tier2PartnerUserId: null });
    expect(r.lines).toContainEqual({ account: "UNALLOCATED_PARTNER_RESERVE", tier: 2, amountE8: usdc("9.6") });
  });

  it("property: lines always sum to revenue, all non-negative, remainder < 4 units", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 16n }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.boolean(),
        fc.boolean(),
        (R, o, p, t, has1, has2) => {
          const r = splitBuilderFee({
            revenueE8: R,
            policy: { botOwnerSharePpm: o, platformShareOfPoolPpm: p, tier1ShareOfPartnerPoolPpm: t },
            botOwnerUserId: "o",
            tier1PartnerUserId: has1 ? "b" : null,
            tier2PartnerUserId: has2 ? "a" : null,
          });
          const sum = r.lines.reduce((s, l) => s + l.amountE8, 0n);
          expect(sum).toBe(R);
          for (const l of r.lines) expect(l.amountE8 >= 0n).toBe(true);
          expect(r.remainder < 4n).toBe(true);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("rejects invalid policies and negative revenue", () => {
    expect(() =>
      splitBuilderFee({ revenueE8: 1n, policy: { ...DEFAULT, botOwnerSharePpm: 1_000_001 }, botOwnerUserId: null, tier1PartnerUserId: null, tier2PartnerUserId: null }),
    ).toThrow();
    expect(() =>
      splitBuilderFee({ revenueE8: -1n, policy: DEFAULT, botOwnerUserId: null, tier1PartnerUserId: null, tier2PartnerUserId: null }),
    ).toThrow();
  });
});

describe("money and rates", () => {
  it("parses Hyperliquid decimals exactly", () => {
    expect(parseUsdcE8("11.28104499").amount).toBe(1_128_104_499n);
    expect(parseUsdcE8("-0.5").amount).toBe(-50_000_000n);
    expect(parseUsdcE8("0.123456789")).toEqual({ amount: 12_345_678n, truncated: true });
    expect(() => parseUsdcE8("1e3")).toThrow();
    expect(formatUsdcE8(1_128_104_499n)).toBe("11.28104499");
  });

  it("converts tenths of bp to percent strings", () => {
    expect(tenthsBpToPercentString(10)).toBe("0.01%");
    expect(tenthsBpToPercentString(1)).toBe("0.001%");
    expect(tenthsBpToPercentString(100)).toBe("0.1%");
  });

  it("estimates base and builder fees separately", () => {
    const e = estimateFees("10000", 20);
    expect(e.builderFeeUsd).toBe("2.000000");
    expect(e.baseTakerFeeUsd).toBe("4.500000");
    expect(e.totalTakerUsd).toBe("6.500000");
  });
});
