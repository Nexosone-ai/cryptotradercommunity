import { E8 } from "../money";
import { krwWithVat, type FxQuote, type KrwPrice } from "../fx";

/** Credit packages in whole USD (CREDIT_PACKAGES_USD="50,100,300,500,1000"). */
export function creditPackagesUsd(): number[] {
  const raw = process.env.CREDIT_PACKAGES_USD || "50,100,300,500,1000";
  const list = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 10 && n <= 100_000);
  return [...new Set(list)].sort((a, b) => a - b);
}

export interface PackageQuote extends KrwPrice {
  usd: number;
  creditE8: bigint;
}

export function quotePackages(fx: FxQuote): PackageQuote[] {
  return creditPackagesUsd().map((usd) => ({ usd, creditE8: BigInt(usd) * E8, ...krwWithVat(usd, fx.rate) }));
}
