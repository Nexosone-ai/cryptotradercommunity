/**
 * Builder-fee revenue split (docs/FEE_POLICY.md).
 *
 * Base = confirmed additional builder fee revenue R (bigint e8).
 *   bot owner  = R × owner
 *   admin pool = R × (1 − owner)
 *     platform net   = pool × platformOfPool
 *     partner pool   = pool × (1 − platformOfPool)
 *       tier1        = partnerPool × tier1
 *       tier2        = partnerPool × (1 − tier1)
 *
 * Each leaf is floored from R with one combined denominator; the leftover
 * (< 4 units) goes to ROUNDING_REMAINDER so that leaves + remainder = R exactly.
 * Partner tiers without an eligible partner go to UNALLOCATED_PARTNER_RESERVE —
 * never to the platform's net revenue.
 */

export const PPM = 1_000_000n;

export interface FeePolicyShares {
  botOwnerSharePpm: number;
  platformShareOfPoolPpm: number;
  tier1ShareOfPartnerPoolPpm: number;
}

export interface SplitInput {
  revenueE8: bigint;
  policy: FeePolicyShares;
  /** Null when the fill has no bot (manual order): owner share goes to platform net. */
  botOwnerUserId: string | null;
  tier1PartnerUserId: string | null;
  tier2PartnerUserId: string | null;
}

export type SplitLine =
  | { account: "BOT_OWNER_PAYABLE"; userId: string; amountE8: bigint }
  | { account: "PARTNER_PAYABLE"; userId: string; tier: 1 | 2; amountE8: bigint }
  | { account: "PLATFORM_NET_REVENUE"; amountE8: bigint; memo?: string }
  | { account: "UNALLOCATED_PARTNER_RESERVE"; tier: 1 | 2; amountE8: bigint }
  | { account: "ROUNDING_REMAINDER"; amountE8: bigint };

export interface SplitResult {
  lines: SplitLine[];
  botOwner: bigint;
  platformNet: bigint;
  tier1: bigint;
  tier2: bigint;
  remainder: bigint;
}

export function validatePolicy(p: FeePolicyShares): void {
  const shares = {
    botOwnerSharePpm: p.botOwnerSharePpm,
    platformShareOfPoolPpm: p.platformShareOfPoolPpm,
    tier1ShareOfPartnerPoolPpm: p.tier1ShareOfPartnerPoolPpm,
  };
  for (const [k, v] of Object.entries(shares)) {
    if (!Number.isInteger(v) || v < 0 || v > 1_000_000) {
      throw new Error(`Fee policy ${k} must be an integer ppm in [0, 1000000]`);
    }
  }
}

export function splitBuilderFee(input: SplitInput): SplitResult {
  const { revenueE8: R, policy } = input;
  if (R < 0n) throw new Error("Revenue must be non-negative");
  validatePolicy(policy);

  const owner = BigInt(policy.botOwnerSharePpm);
  const pool = PPM - owner;
  const platformOfPool = BigInt(policy.platformShareOfPoolPpm);
  const partnersOfPool = PPM - platformOfPool;
  const t1 = BigInt(policy.tier1ShareOfPartnerPoolPpm);
  const t2 = PPM - t1;

  const botOwner = (R * owner) / PPM;
  const platformNet = (R * pool * platformOfPool) / (PPM * PPM);
  const tier1 = (R * pool * partnersOfPool * t1) / (PPM * PPM * PPM);
  const tier2 = (R * pool * partnersOfPool * t2) / (PPM * PPM * PPM);
  const remainder = R - botOwner - platformNet - tier1 - tier2;

  const lines: SplitLine[] = [];
  if (input.botOwnerUserId) {
    lines.push({ account: "BOT_OWNER_PAYABLE", userId: input.botOwnerUserId, amountE8: botOwner });
  } else {
    lines.push({ account: "PLATFORM_NET_REVENUE", amountE8: botOwner, memo: "owner share of non-bot order" });
  }
  lines.push({ account: "PLATFORM_NET_REVENUE", amountE8: platformNet });
  lines.push(
    input.tier1PartnerUserId
      ? { account: "PARTNER_PAYABLE", userId: input.tier1PartnerUserId, tier: 1, amountE8: tier1 }
      : { account: "UNALLOCATED_PARTNER_RESERVE", tier: 1, amountE8: tier1 },
  );
  lines.push(
    input.tier2PartnerUserId
      ? { account: "PARTNER_PAYABLE", userId: input.tier2PartnerUserId, tier: 2, amountE8: tier2 }
      : { account: "UNALLOCATED_PARTNER_RESERVE", tier: 2, amountE8: tier2 },
  );
  lines.push({ account: "ROUNDING_REMAINDER", amountE8: remainder });

  return { lines, botOwner, platformNet, tier1, tier2, remainder };
}
