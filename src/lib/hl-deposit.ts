import Decimal from "decimal.js";
import type { HlNetwork } from "./config";

/**
 * Depositing to Hyperliquid = sending native USDC on Arbitrum to Hyperliquid's
 * bridge contract; it is credited to the SENDING address's Hyperliquid account in
 * under a minute. Addresses from Hyperliquid's Bridge2 docs, checked on-chain on
 * 2026-10-29 (the bridge's usdcToken() returns exactly these USDC contracts).
 * Below the minimum the deposit is not credited and is lost forever.
 */
export const HL_DEPOSIT: Record<HlNetwork, { chainId: number; usdc: `0x${string}`; bridge: `0x${string}`; usdcSymbol: string }> = {
  mainnet: {
    chainId: 42161,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    bridge: "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7",
    usdcSymbol: "USDC",
  },
  testnet: {
    chainId: 421614,
    usdc: "0x1baAbB04529D43a73232B713C0FE471f7c7334d5",
    bridge: "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89",
    usdcSymbol: "USDC2",
  },
};

export const MIN_DEPOSIT_USDC = new Decimal(5);

/** Why an amount can't be deposited, or null if it can. Amount is a decimal string in USDC. */
export function depositProblem(amount: string, balance: Decimal | null): string | null {
  let a: Decimal;
  try {
    a = new Decimal(amount.trim());
  } catch {
    return "Enter an amount.";
  }
  if (!a.isFinite() || a.lte(0)) return "Enter an amount.";
  if (a.decimalPlaces() > 6) return "USDC has at most 6 decimal places.";
  if (a.lt(MIN_DEPOSIT_USDC)) return `The minimum deposit is ${MIN_DEPOSIT_USDC.toFixed()} USDC. Smaller deposits are never credited and are lost.`;
  if (balance && a.gt(balance)) return "That's more USDC than this wallet holds on Arbitrum.";
  return null;
}
