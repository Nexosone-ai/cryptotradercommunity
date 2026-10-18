/**
 * Exact money helpers. Ledger amounts are bigint units of 1e-8 USDC ("e8").
 * Never pass ledger amounts through JS floats.
 */

export const E8 = 100_000_000n;
const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Parses a decimal string (as returned by Hyperliquid) into e8 units.
 * Digits beyond 8 decimals are truncated toward zero and reported as dust.
 */
export function parseUsdcE8(value: string): { amount: bigint; truncated: boolean } {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) throw new Error(`Invalid decimal amount: ${value}`);
  const [, neg, whole, frac = ""] = m;
  const kept = (frac + "00000000").slice(0, 8);
  const truncated = /[1-9]/.test(frac.slice(8));
  const abs = BigInt(whole) * E8 + BigInt(kept);
  return { amount: neg ? -abs : abs, truncated };
}

/** Formats e8 units as a decimal string, trimming trailing zeros (min 2 decimals). */
export function formatUsdcE8(amount: bigint, minDecimals = 2): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const whole = abs / E8;
  let frac = (abs % E8).toString().padStart(8, "0").replace(/0+$/, "");
  if (frac.length < minDecimals) frac = frac.padEnd(minDecimals, "0");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

/** JSON-safe serialization of bigint e8 amounts. */
export function e8ToJson(amount: bigint): string {
  return amount.toString();
}
