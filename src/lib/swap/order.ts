import Decimal from "decimal.js";
import { getAddress, hashTypedData, isAddress, zeroAddress, type Address, type Hex } from "viem";

/** Must match CtcP2PSwap.sol (EIP712("CTC P2P Swap", "1")). */
export const SWAP_EIP712_NAME = "CTC P2P Swap";
export const SWAP_EIP712_VERSION = "1";

export const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "taker", type: "address" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

// A type alias (not an interface) so viem's typed-data message accepts it.
export type SwapOrder = {
  maker: Address;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  buyAmount: bigint;
  taker: Address;
  expiry: bigint;
  nonce: bigint;
};

/** JSON form (bigints as decimal strings). */
export interface SwapOrderJson {
  maker: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  taker: string;
  expiry: string;
  nonce: string;
}

const UINT_RE = /^\d{1,78}$/;

export function orderFromJson(j: SwapOrderJson): SwapOrder {
  for (const k of ["maker", "sellToken", "buyToken", "taker"] as const) {
    if (!isAddress(j[k], { strict: false })) throw new Error(`invalid ${k}`);
  }
  for (const k of ["sellAmount", "buyAmount", "expiry", "nonce"] as const) {
    if (!UINT_RE.test(j[k])) throw new Error(`invalid ${k}`);
  }
  return {
    maker: getAddress(j.maker),
    sellToken: getAddress(j.sellToken),
    buyToken: getAddress(j.buyToken),
    sellAmount: BigInt(j.sellAmount),
    buyAmount: BigInt(j.buyAmount),
    taker: j.taker ? getAddress(j.taker) : zeroAddress,
    expiry: BigInt(j.expiry),
    nonce: BigInt(j.nonce),
  };
}

export function orderToJson(o: SwapOrder): SwapOrderJson {
  return {
    maker: o.maker,
    sellToken: o.sellToken,
    buyToken: o.buyToken,
    sellAmount: o.sellAmount.toString(),
    buyAmount: o.buyAmount.toString(),
    taker: o.taker,
    expiry: o.expiry.toString(),
    nonce: o.nonce.toString(),
  };
}

export function swapDomain(chainId: number, contract: Address) {
  return { name: SWAP_EIP712_NAME, version: SWAP_EIP712_VERSION, chainId, verifyingContract: contract } as const;
}

export function hashSwapOrder(chainId: number, contract: Address, o: SwapOrder): Hex {
  return hashTypedData({ domain: swapDomain(chainId, contract), types: ORDER_TYPES, primaryType: "Order", message: o });
}

/** Human amount ("12.5") → base units, exact; rejects more decimals than the token has. */
export function toUnits(value: string, decimals: number): bigint {
  const v = value.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error("숫자 형식이 올바르지 않습니다.");
  const [whole, frac = ""] = v.split(".");
  if (frac.length > decimals) throw new Error(`소수점 이하 ${decimals}자리까지만 입력할 수 있습니다.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function fromUnits(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${abs / base}${frac ? "." + frac : ""}`;
}

/** Price as "buy token per 1 sell token" for display. */
export function orderPrice(sellAmount: bigint, sellDecimals: number, buyAmount: bigint, buyDecimals: number): string {
  if (sellAmount === 0n) return "0";
  return new Decimal(fromUnits(buyAmount, buyDecimals)).div(fromUnits(sellAmount, sellDecimals)).toSignificantDigits(10).toFixed();
}

/** Same rounding as the contract: floor(pay * sellAmount / buyAmount). */
export function sellAmountForPayment(o: Pick<SwapOrder, "sellAmount" | "buyAmount">, buyAmountToPay: bigint): bigint {
  return (buyAmountToPay * o.sellAmount) / o.buyAmount;
}
