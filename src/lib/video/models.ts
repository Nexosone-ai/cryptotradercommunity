/**
 * Partner video service: model catalog and pricing (docs/PARTNER_VIDEO.md).
 *
 * Costs use fal.ai list prices checked on 2026-10-27 — the regular rates, not
 * the promotional ones that end 2026-10-31 — so the platform does not
 * under-charge once a promotion ends. Update this table if fal changes prices.
 */
import { E8 } from "../money";
import { bi } from "../i18n";

export const VIDEO_MODEL = "minimax/h3-max/image-to-video";
export const FRAME_MODEL = "fal-ai/ffmpeg-api/extract-frame";
export const VISION_MODEL_ENDPOINT = "openrouter/router/vision";
export const VISION_LLM = "google/gemini-2.5-flash";

/** USD per output second, as e8 units. */
export const RESOLUTIONS = {
  "480P": { label: "480p", costPerSecondE8: 5_000_000n }, // $0.05/s
  "768P": { label: "768p", costPerSecondE8: 8_000_000n }, // $0.08/s
} as const;
export type Resolution = keyof typeof RESOLUTIONS;

export const CLIP_SECONDS = [5, 10] as const;
export type ClipSeconds = (typeof CLIP_SECONDS)[number];

/** Number of similar videos generated per upload. */
export const CLIPS_PER_JOB = 10;

/** Frame extraction + vision LLM per job (fal bills a fraction of this; conservative). */
export const ANALYSIS_COST_E8 = 2_000_000n; // $0.02

/** Default markup: price = cost × 1.4 (40% above cost). */
export const DEFAULT_MARKUP_PPM = 1_400_000;

const PPM = 1_000_000n;

function ceilMul(costE8: bigint, markupPpm: number): bigint {
  const m = BigInt(markupPpm);
  return (costE8 * m + PPM - 1n) / PPM;
}

export interface VideoQuote {
  resolution: Resolution;
  clipSeconds: number;
  clipCount: number;
  markupPpm: number;
  clipCostE8: bigint;
  analysisCostE8: bigint;
  costE8: bigint;
  clipPriceE8: bigint;
  analysisPriceE8: bigint;
  priceE8: bigint;
}

/**
 * Price = cost × markup, rounded up, computed per part so a failed clip can be
 * refunded exactly: price = analysisPrice + clipPrice × clipCount.
 */
export function quoteVideoJob(resolution: Resolution, clipSeconds: number, markupPpm = DEFAULT_MARKUP_PPM, clipCount = CLIPS_PER_JOB): VideoQuote {
  if (!(resolution in RESOLUTIONS)) throw new Error("Unsupported resolution");
  if (!(CLIP_SECONDS as readonly number[]).includes(clipSeconds)) throw new Error("Unsupported clip length");
  if (!Number.isInteger(markupPpm) || markupPpm < 1_000_000 || markupPpm > 10_000_000) throw new Error("Invalid markup");
  const clipCostE8 = RESOLUTIONS[resolution].costPerSecondE8 * BigInt(clipSeconds);
  const clipPriceE8 = ceilMul(clipCostE8, markupPpm);
  const analysisPriceE8 = ceilMul(ANALYSIS_COST_E8, markupPpm);
  return {
    resolution,
    clipSeconds,
    clipCount,
    markupPpm,
    clipCostE8,
    analysisCostE8: ANALYSIS_COST_E8,
    costE8: ANALYSIS_COST_E8 + clipCostE8 * BigInt(clipCount),
    clipPriceE8,
    analysisPriceE8,
    priceE8: analysisPriceE8 + clipPriceE8 * BigInt(clipCount),
  };
}

export function usdToE8(value: string): bigint {
  const v = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new Error(bi("Enter the amount in USD with up to two decimal places.", "금액은 소수점 둘째 자리까지의 USD로 입력하세요."));
  const [w, f = ""] = v.split(".");
  return BigInt(w) * E8 + BigInt((f + "00").slice(0, 2)) * 1_000_000n;
}
