import Decimal from "decimal.js";

/**
 * Hyperliquid perp tick rules: prices use at most 5 significant figures and
 * at most (6 − szDecimals) decimals (integer prices are always valid);
 * sizes are rounded to szDecimals.
 */
const PERP_MAX_DECIMALS = 6;

export function formatPerpPrice(price: Decimal.Value, szDecimals: number, rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP) {
  const p = new Decimal(price);
  if (!p.isFinite() || p.lte(0)) throw new Error("Invalid price");
  const maxDecimals = Math.max(PERP_MAX_DECIMALS - szDecimals, 0);
  // Integer prices are always valid, so prices ≥ 100000 round to an integer instead of losing digits.
  if (p.gte(100_000)) return p.toDecimalPlaces(0, rounding).toFixed(0);
  const sig = p.toSignificantDigits(5, rounding);
  return trimZeros(sig.toDecimalPlaces(maxDecimals, rounding).toFixed());
}

export function formatPerpSize(size: Decimal.Value, szDecimals: number) {
  const s = new Decimal(size).toDecimalPlaces(szDecimals, Decimal.ROUND_DOWN);
  if (s.lte(0)) throw new Error("Size rounds to zero for this market");
  return trimZeros(s.toFixed());
}

function trimZeros(v: string) {
  return v.includes(".") ? v.replace(/\.?0+$/, "") : v;
}

/** Random 128-bit client order id, recorded against the bot/run in `orders`. */
export function newCloid(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function explorerAddressUrl(address: string, network: "testnet" | "mainnet") {
  return network === "mainnet"
    ? `https://app.hyperliquid.xyz/explorer/address/${address}`
    : `https://app.hyperliquid-testnet.xyz/explorer/address/${address}`;
}
