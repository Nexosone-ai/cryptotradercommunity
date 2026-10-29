import Decimal from "decimal.js";

/** Hyperliquid account abstraction mode (info `userAbstraction`). "default" is Standard. */
export type AccountMode = "unifiedAccount" | "portfolioMargin" | "disabled" | "default";

/**
 * Unified account and portfolio margin keep one balance per asset, shared by spot
 * and perps, and report it ONLY in the spot clearinghouse state; the perps
 * account value then reads 0. Standard accounts keep separate spot and perps balances.
 */
export function isUnifiedMode(mode: AccountMode | null | undefined): boolean {
  return mode === "unifiedAccount" || mode === "portfolioMargin";
}

const dec = (v: string | null | undefined) => {
  try {
    return new Decimal(v ?? "0");
  } catch {
    return new Decimal(0);
  }
};

/** The USDC an account can trade with, whatever its mode. Decimal strings, display only. */
export function tradingBalance(input: {
  mode: AccountMode | null | undefined;
  perpsValue?: string | null;
  perpsWithdrawable?: string | null;
  spotUsdcTotal?: string | null;
  spotUsdcHold?: string | null;
}): { value: string; available: string; unified: boolean } {
  if (isUnifiedMode(input.mode)) {
    const total = dec(input.spotUsdcTotal);
    return { value: total.toFixed(), available: Decimal.max(total.minus(dec(input.spotUsdcHold)), 0).toFixed(), unified: true };
  }
  return { value: dec(input.perpsValue).toFixed(), available: dec(input.perpsWithdrawable).toFixed(), unified: false };
}
