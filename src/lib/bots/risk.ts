import type { BotConfig } from "./schema";
import { bi } from "../i18n";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

export interface RiskFinding {
  severity: "BLOCK" | "WARN";
  code: string;
  message: string;
}

/**
 * Pre-submission risk screen. BLOCK findings stop submission; WARN findings
 * are shown to reviewers and on the public bot page.
 */
export function assessBotRisk(c: BotConfig, platformMaxFeeTenthsBp: number): { level: RiskLevel; findings: RiskFinding[] } {
  const findings: RiskFinding[] = [];
  const block = (code: string, message: string) => findings.push({ severity: "BLOCK", code, message });
  const warn = (code: string, message: string) => findings.push({ severity: "WARN", code, message });

  if (c.feeTenthsBp > platformMaxFeeTenthsBp) {
    block("FEE_ABOVE_PLATFORM_CAP", bi(`The additional Builder Fee must not exceed the platform cap (${platformMaxFeeTenthsBp / 1000}%).`, `추가 Builder Fee는 플랫폼 상한(${platformMaxFeeTenthsBp / 1000}%) 이하여야 합니다.`));
  }
  if (c.risk.stopLossPct > 50) block("STOP_LOSS_TOO_WIDE", bi("A bot with a stop loss wider than 50% can't be registered.", "손절 폭이 50%를 초과하면 등록할 수 없습니다."));
  if (c.risk.maxLeverage > 25) warn("HIGH_LEVERAGE", bi("Max leverage above 25x: the liquidation risk is very high.", "최대 레버리지 25배 초과: 강제청산 위험이 매우 높습니다."));
  // The stop loss is a price move from entry, not a share of the margin: at L× a move of 100/L % uses up the position's margin.
  const marginGone = 100 / c.risk.maxLeverage;
  const stopBeyondMargin = c.risk.stopLossPct >= marginGone;
  if (stopBeyondMargin) {
    warn(
      "STOP_BEYOND_MARGIN",
      bi(
        `The ${c.risk.stopLossPct}% stop loss is a price move from entry. At ${c.risk.maxLeverage}x a ${+marginGone.toFixed(2)}% move already uses up the position's margin (a ${c.risk.stopLossPct}% stop loses ${+(c.risk.stopLossPct * c.risk.maxLeverage).toFixed(0)}% of it), so the stop only triggers if the rest of the account covers the loss; otherwise the position is liquidated first. The engine skips entries the account can't cover.`,
        `${c.risk.stopLossPct}% 손절은 진입가 대비 가격 변동입니다. ${c.risk.maxLeverage}배에서는 ${+marginGone.toFixed(2)}% 변동에 포지션 증거금이 모두 소진되며(${c.risk.stopLossPct}% 손절 시 증거금의 ${+(c.risk.stopLossPct * c.risk.maxLeverage).toFixed(0)}% 손실), 계좌의 나머지 자금이 손실을 감당하지 못하면 손절 전에 강제청산됩니다. 엔진은 계좌가 감당할 수 없는 진입을 건너뜁니다.`,
      ),
    );
  }
  if (c.risk.dailyLossLimitUsd > c.risk.maxPositionUsd) {
    warn("DAILY_LOSS_ABOVE_POSITION", bi("The daily loss limit is larger than the max position size.", "일일 손실 한도가 최대 포지션 규모보다 큽니다."));
  }
  if (c.strategyType === "MARTINGALE") warn("MARTINGALE", bi("Martingale strategies can grow positions rapidly during a losing streak.", "마틴게일 전략은 연속 손실 시 포지션이 급격히 커질 수 있습니다."));
  if (c.strategyType === "ARBITRAGE") {
    warn("ARBITRAGE_FEASIBILITY", bi("Arbitrage strategies are approved only after their feasibility (latency, fees) is verified.", "차익거래 전략은 실행 가능성(지연·수수료) 검증 후에만 승인됩니다."));
  }
  if (c.executionMode === "WEBHOOK_SIGNAL") {
    warn("WEBHOOK_REVIEW", bi("External webhook signals need a security review of signing, replay protection and IP restrictions.", "외부 Webhook 신호는 서명·재전송 방지·IP 제한 보안 심사가 필요합니다."));
  }
  if (c.executionMode === "COPY_TRADE") {
    warn("COPY_TRADING", "Followers copy the leader's own Hyperliquid trades about a minute later, at their own prices; the leader's results don't carry over exactly.");
  }
  if (c.executionMode === "VERIFIED_PACKAGE") {
    warn("PACKAGE_REVIEW", bi("Strategy packages run only after sandbox isolation and dependency checks (Phase 2).", "전략 패키지는 샌드박스 격리·의존성 검사 후 실행됩니다 (Phase 2)."));
  }

  const blocks = findings.filter((f) => f.severity === "BLOCK").length;
  const warns = findings.filter((f) => f.severity === "WARN").length;
  let level: RiskLevel = "LOW";
  if (c.risk.maxLeverage > 10 || warns >= 1) level = "MEDIUM";
  if (c.risk.maxLeverage > 25 || c.strategyType === "MARTINGALE" || stopBeyondMargin || warns >= 3) level = "HIGH";
  if (blocks > 0 || c.risk.maxLeverage > 40) level = "EXTREME";
  return { level, findings };
}
