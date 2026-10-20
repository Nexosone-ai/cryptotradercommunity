import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fromUnits, orderFromJson, orderPrice, sellAmountForPayment, toUnits } from "@/lib/swap/order";
import { SWAP_MAINNETS, SWAP_TESTNETS } from "@/lib/swap/chains";
import { getSwapConfig } from "@/lib/swap/config";

describe("swap amount helpers", () => {
  it("converts human amounts to base units exactly", () => {
    expect(toUnits("12.5", 6)).toBe(12_500_000n);
    expect(toUnits("0.000000000000000001", 18)).toBe(1n);
    expect(() => toUnits("1.1234567", 6)).toThrow();
    expect(() => toUnits("1e5", 6)).toThrow();
    expect(fromUnits(12_500_000n, 6)).toBe("12.5");
    expect(fromUnits(10n ** 18n, 18)).toBe("1");
  });

  it("round-trips any amount", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 40n }), fc.integer({ min: 0, max: 30 }), (v, d) => {
        expect(toUnits(fromUnits(v, d), d)).toBe(v);
      }),
    );
  });

  it("prices as buy-token per 1 sell-token and pays out like the contract", () => {
    expect(orderPrice(100n * 10n ** 18n, 18, 250n * 10n ** 6n, 6)).toBe("2.5");
    const o = { sellAmount: 100n * 10n ** 18n, buyAmount: 250n * 10n ** 6n };
    expect(sellAmountForPayment(o, 100n * 10n ** 6n)).toBe(40n * 10n ** 18n);
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 30n }), fc.bigInt({ min: 1n, max: 10n ** 30n }), fc.bigInt({ min: 0n, max: 10n ** 30n }), (s, b, pay) => {
        const out = sellAmountForPayment({ sellAmount: s, buyAmount: b }, pay);
        expect(out * b <= pay * s).toBe(true);
      }),
    );
  });

  it("validates order JSON", () => {
    const ok = {
      maker: "0x1111111111111111111111111111111111111111",
      sellToken: "0x2222222222222222222222222222222222222222",
      buyToken: "0x3333333333333333333333333333333333333333",
      sellAmount: "1",
      buyAmount: "2",
      taker: "0x0000000000000000000000000000000000000000",
      expiry: "1800000000",
      nonce: "7",
    };
    expect(orderFromJson(ok).buyAmount).toBe(2n);
    expect(() => orderFromJson({ ...ok, sellAmount: "-1" })).toThrow();
    expect(() => orderFromJson({ ...ok, maker: "0x123" })).toThrow();
  });
});

describe("swap chains", () => {
  it("covers Ethereum, BNB, Polygon, Base and Robinhood on testnet and mainnet", () => {
    expect(SWAP_TESTNETS.map((c) => c.id)).toEqual([11155111, 97, 80002, 84532, 46630]);
    expect(SWAP_MAINNETS.map((c) => c.id)).toEqual([1, 56, 137, 8453, 4663]);
    expect(SWAP_TESTNETS.find((c) => c.id === 97)?.tokenStandard).toBe("BEP-20");
  });

  it("stays on testnets unless mainnet is explicitly enabled", () => {
    expect(getSwapConfig().network).toBe("testnet");
    process.env.SWAP_NETWORK = "mainnet";
    expect(getSwapConfig().network).toBe("testnet");
    process.env.SWAP_MAINNET_ENABLED = "true";
    expect(getSwapConfig().chains.map((c) => c.id)).toEqual([1, 56, 137, 8453, 4663]);
    delete process.env.SWAP_NETWORK;
    delete process.env.SWAP_MAINNET_ENABLED;
  });
});
