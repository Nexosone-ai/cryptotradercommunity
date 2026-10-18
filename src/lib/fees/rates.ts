import Decimal from "decimal.js";

/**
 * Fee-rate units. Hyperliquid's builder `f` field and the `maxBuilderFee`
 * info response are integers in tenths of a basis point: 10 = 1bp = 0.01%.
 */

/** 50 → "0.05%" (format required by approveBuilderFee.maxFeeRate). */
export function tenthsBpToPercentString(tenthsBp: number): `${string}%` {
  if (!Number.isInteger(tenthsBp) || tenthsBp < 0) throw new Error("Invalid fee rate");
  return `${new Decimal(tenthsBp).div(1000).toFixed()}%`;
}

/** 50 → 0.0005 as a Decimal fraction of notional. */
export function tenthsBpToFraction(tenthsBp: number): Decimal {
  return new Decimal(tenthsBp).div(100_000);
}

export function formatTenthsBp(tenthsBp: number): string {
  return `${new Decimal(tenthsBp).div(1000).toFixed()}% (${new Decimal(tenthsBp).div(10).toFixed()}bp)`;
}

/** Hyperliquid base perps fee, tier 0 (docs: trading/fees, checked 2026-10-18). */
export const HL_BASE_PERP_FEE = {
  taker: new Decimal("0.00045"),
  maker: new Decimal("0.00015"),
  source: "Hyperliquid fee schedule, tier 0 (account tier, staking and referral discounts may lower it)",
} as const;

export interface FeeEstimate {
  notionalUsd: string;
  baseTakerFeeUsd: string;
  baseMakerFeeUsd: string;
  builderFeeUsd: string;
  totalTakerUsd: string;
  totalMakerUsd: string;
  builderFeeTenthsBp: number;
  builderFeePercent: string;
}

/** Estimated fees for a hypothetical fill. Actual fees come from the fill. */
export function estimateFees(notionalUsd: string | number, builderFeeTenthsBp: number): FeeEstimate {
  const n = new Decimal(notionalUsd);
  if (!n.isFinite() || n.isNegative()) throw new Error("Invalid notional");
  const builder = n.mul(tenthsBpToFraction(builderFeeTenthsBp));
  const taker = n.mul(HL_BASE_PERP_FEE.taker);
  const maker = n.mul(HL_BASE_PERP_FEE.maker);
  return {
    notionalUsd: n.toFixed(2),
    baseTakerFeeUsd: taker.toFixed(6),
    baseMakerFeeUsd: maker.toFixed(6),
    builderFeeUsd: builder.toFixed(6),
    totalTakerUsd: taker.plus(builder).toFixed(6),
    totalMakerUsd: maker.plus(builder).toFixed(6),
    builderFeeTenthsBp,
    builderFeePercent: tenthsBpToPercentString(builderFeeTenthsBp),
  };
}
