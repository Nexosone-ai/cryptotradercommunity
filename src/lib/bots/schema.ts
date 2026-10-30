import { z } from "zod";
import { HL_MAX_PERP_BUILDER_FEE_TENTHS_BP } from "../config";
import { sourceInputSchema, type SourceMeta } from "./source";
import { bi } from "../i18n";

export const STRATEGY_TYPES = ["TREND_FOLLOWING", "GRID", "MARTINGALE", "TP_TRADING", "ARBITRAGE", "COPY_TRADING", "CUSTOM"] as const;
export const STRATEGY_LABELS: Record<(typeof STRATEGY_TYPES)[number], string> = {
  TREND_FOLLOWING: "Trend Following",
  GRID: "Grid",
  MARTINGALE: "Martingale",
  TP_TRADING: "TP Trading",
  ARBITRAGE: "Arbitrage",
  COPY_TRADING: "Copy trading",
  CUSTOM: "Custom",
};
export const EXECUTION_MODES = ["PLATFORM_TEMPLATE", "VERIFIED_PACKAGE", "WEBHOOK_SIGNAL", "COPY_TRADE"] as const;
export const EXECUTION_LABELS: Record<(typeof EXECUTION_MODES)[number], string> = {
  PLATFORM_TEMPLATE: bi("Platform strategy template", "플랫폼 전략 템플릿"),
  VERIFIED_PACKAGE: bi("Verified strategy package (review required)", "검증된 전략 패키지 (심사 필요)"),
  WEBHOOK_SIGNAL: bi("External signal webhook (security review required)", "외부 신호 Webhook (보안 심사 필요)"),
  COPY_TRADE: "Copy my Hyperliquid trades (copy trading)",
};
export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export const ORDER_TYPES = ["MARKET", "LIMIT", "STOP_MARKET", "TAKE_PROFIT"] as const;
/** Phase 1 market scope: Hyperliquid perps only. */
export const MARKET_RE = /^[A-Z0-9]{1,15}-PERP$/;

const optionalUrl = z.union([z.literal(""), z.url({ protocol: /^https$/ })]).optional();

export const botConfigSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, bi("3–48 lowercase letters, numbers or hyphens", "영문 소문자, 숫자, 하이픈 3~48자")),
    logoUrl: optionalUrl,
    summary: z.string().trim().min(10).max(140),
    description: z.string().trim().min(30).max(8000),
    strategyType: z.enum(STRATEGY_TYPES),
    markets: z.array(z.string().regex(MARKET_RE)).min(1).max(10),
    direction: z.enum(["LONG", "SHORT", "BOTH"]),
    leverageMin: z.number().int().min(1).max(50),
    leverageMax: z.number().int().min(1).max(50),
    timeframe: z.enum(TIMEFRAMES),
    orderTypes: z.array(z.enum(ORDER_TYPES)).min(1),
    risk: z.object({
      maxOrderUsd: z.number().positive().max(1_000_000),
      maxPositionUsd: z.number().positive().max(10_000_000),
      maxLeverage: z.number().int().min(1).max(50),
      stopLossPct: z.number().positive().max(100),
      dailyLossLimitUsd: z.number().positive().max(1_000_000),
      emergencyStop: z.literal(true, bi("Emergency stop (kill switch) support is required.", "긴급 중단(kill switch) 지원은 필수입니다.")),
    }),
    executionMode: z.enum(EXECUTION_MODES),
    developer: z.object({
      bio: z.string().trim().max(1000).default(""),
      blogUrl: optionalUrl,
      xUrl: optionalUrl,
      telegramUrl: optionalUrl,
    }),
    feeTenthsBp: z.number().int().min(0).max(HL_MAX_PERP_BUILDER_FEE_TENTHS_BP),
    /** Optional strategy source code (never executed; see lib/bots/source.ts). */
    source: sourceInputSchema.optional(),
    consents: z.object({
      terms: z.literal(true, bi("You must accept the terms of use.", "이용약관 동의가 필요합니다.")),
      risk: z.literal(true, bi("You must accept the risk disclosure.", "위험 고지 동의가 필요합니다.")),
      performancePolicy: z.literal(true, bi("You must accept the performance display policy.", "수익률 표시 정책 동의가 필요합니다.")),
    }),
  })
  .refine((c) => c.leverageMin <= c.leverageMax, { path: ["leverageMax"], message: bi("Max leverage must be at least the minimum leverage.", "최대 레버리지는 최소값 이상이어야 합니다.") })
  .refine((c) => c.risk.maxLeverage <= c.leverageMax, {
    path: ["risk", "maxLeverage"],
    message: bi("The risk-limit max leverage must be within the leverage range.", "위험 한도 최대 레버리지는 레버리지 범위 안이어야 합니다."),
  })
  .refine((c) => c.risk.maxOrderUsd <= c.risk.maxPositionUsd, {
    path: ["risk", "maxOrderUsd"],
    message: bi("The max order size must not exceed the max position size.", "1회 최대 주문은 최대 포지션 규모 이하여야 합니다."),
  })
  .refine((c) => (c.strategyType === "COPY_TRADING") === (c.executionMode === "COPY_TRADE"), {
    path: ["executionMode"],
    message: "Copy trading uses the execution mode “Copy my Hyperliquid trades”, and that mode is only for the Copy trading strategy type.",
  });

export function isCopyBot(c: Pick<BotConfig, "executionMode">): boolean {
  return c.executionMode === "COPY_TRADE";
}

export type BotConfig = z.infer<typeof botConfigSchema>;
/** What is stored in bots.config: the source is replaced by its metadata + hash. */
export type StoredBotConfig = Omit<BotConfig, "source"> & { source?: SourceMeta };
/** Any client-supplied owner address is ignored; the server sets it. */
export type BotConfigInput = z.input<typeof botConfigSchema>;
