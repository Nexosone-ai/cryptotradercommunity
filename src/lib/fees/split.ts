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
 *
 * Wholesale model (wholesalerPortionPpm set; fee events from 2026-10-30):
 *   partner pool is shared by the client's affiliate (tier 1) and the wholesaler (tier 2):
 *     wholesaler = min(R × portion, partner pool), affiliate = partner pool − wholesaler.
 *   A client referred by the wholesaler directly: the wholesaler gets the whole partner pool.
 *   A share with no eligible partner (no referrer, or a suspended one) goes to the platform.
 *
 * Legacy model (wholesalerPortionPpm null; events recorded before): tier1/tier2 by the
 * policy's tier1 share, and a missing tier goes to UNALLOCATED_PARTNER_RESERVE.
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
  /** Wholesaler's portion (ppm of R) snapshotted at fill time; null = legacy tier split. */
  wholesalerPortionPpm?: number | null;
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
  const botOwner = (R * owner) / PPM;
  const platformNet = (R * pool * platformOfPool) / (PPM * PPM);

  const lines: SplitLine[] = [];
  if (input.botOwnerUserId) {
    lines.push({ account: "BOT_OWNER_PAYABLE", userId: input.botOwnerUserId, amountE8: botOwner });
  } else {
    lines.push({ account: "PLATFORM_NET_REVENUE", amountE8: botOwner, memo: "owner share of non-bot order" });
  }
  lines.push({ account: "PLATFORM_NET_REVENUE", amountE8: platformNet });

  if (input.wholesalerPortionPpm != null) {
    const partnerPool = (R * pool * partnersOfPool) / (PPM * PPM);
    const portion = BigInt(Math.max(0, Math.min(1_000_000, Math.trunc(input.wholesalerPortionPpm))));
    const affiliate = input.tier1PartnerUserId;
    const wholesaler = input.tier2PartnerUserId;
    // Wholesaler's cut applies only when an affiliate brought the client; a direct client's pool is all theirs.
    const wholesalerCut = affiliate === null && wholesaler !== null ? partnerPool : minBig((R * portion) / PPM, partnerPool);
    const tier2 = wholesalerCut;
    const tier1 = partnerPool - wholesalerCut;
    const remainder = R - botOwner - platformNet - tier1 - tier2;
    if (affiliate) lines.push({ account: "PARTNER_PAYABLE", userId: affiliate, tier: 1, amountE8: tier1 });
    else if (tier1 > 0n) lines.push({ account: "PLATFORM_NET_REVENUE", amountE8: tier1, memo: "no affiliate" });
    if (wholesaler) lines.push({ account: "PARTNER_PAYABLE", userId: wholesaler, tier: 2, amountE8: tier2 });
    else if (tier2 > 0n) lines.push({ account: "PLATFORM_NET_REVENUE", amountE8: tier2, memo: "no wholesale partner" });
    lines.push({ account: "ROUNDING_REMAINDER", amountE8: remainder });
    return { lines, botOwner, platformNet, tier1: affiliate ? tier1 : 0n, tier2: wholesaler ? tier2 : 0n, remainder };
  }

  const t1 = BigInt(policy.tier1ShareOfPartnerPoolPpm);
  const t2 = PPM - t1;
  const tier1 = (R * pool * partnersOfPool * t1) / (PPM * PPM * PPM);
  const tier2 = (R * pool * partnersOfPool * t2) / (PPM * PPM * PPM);
  const remainder = R - botOwner - platformNet - tier1 - tier2;
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

const minBig = (a: bigint, b: bigint) => (a < b ? a : b);
