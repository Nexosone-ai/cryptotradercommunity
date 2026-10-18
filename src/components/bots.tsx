import Link from "next/link";
import type { PublicBotCard } from "@/lib/bots/queries";
import { STRATEGY_LABELS } from "@/lib/bots/schema";
import { estimateFees, HL_BASE_PERP_FEE } from "@/lib/fees/rates";
import { feeLabel, RISK_LABELS, shortAddress, usd } from "@/lib/format";
import { VERIFICATION_LABELS, type Verification } from "@/lib/performance/metrics";
import { Badge } from "./ui";

export function VerificationBadge({ v }: { v: Verification }) {
  const tone = v === "VERIFIED_LIVE" || v === "VERIFIED_HISTORICAL" ? "up" : v === "BACKTEST" ? "blue" : "neutral";
  return <Badge tone={tone}>{v === "VERIFIED_LIVE" ? "✓ " : ""}{VERIFICATION_LABELS[v]}</Badge>;
}

export function RiskBadge({ level }: { level: string }) {
  const tone = level === "LOW" ? "up" : level === "MEDIUM" ? "warn" : "down";
  return <Badge tone={tone}>{RISK_LABELS[level] ?? level}</Badge>;
}

/** Performance number that never shows fabricated values for unverified bots. */
function Perf({ card, field }: { card: PublicBotCard; field: "netPnlUsd" | "maxDrawdownUsd" }) {
  if (card.metrics.verification !== "VERIFIED_LIVE") return <span className="text-faint">검증 데이터 부족</span>;
  const v = Number(card.metrics[field]);
  return <span className={field === "netPnlUsd" ? (v >= 0 ? "text-up" : "text-down") : "text-down"}>{usd(field === "maxDrawdownUsd" ? -v : v)}</span>;
}

export function BotCard({ card }: { card: PublicBotCard }) {
  return (
    <Link
      href={`/bots/${card.slug}`}
      className="group flex flex-col rounded-xl border border-line bg-panel p-4 transition hover:border-accent/50"
      data-testid="bot-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold group-hover:text-accent">{card.name}</h3>
          <p className="text-xs text-muted">
            {STRATEGY_LABELS[card.strategyType as keyof typeof STRATEGY_LABELS] ?? card.strategyType} · {card.markets.join(", ")}
          </p>
        </div>
        <VerificationBadge v={card.metrics.verification} />
      </div>
      <p className="mt-3 line-clamp-2 text-sm text-muted">{card.summary}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-faint">순손익 (누적)</dt>
          <dd className="num mt-0.5">
            <Perf card={card} field="netPnlUsd" />
          </dd>
        </div>
        <div>
          <dt className="text-faint">최대 낙폭</dt>
          <dd className="num mt-0.5">
            <Perf card={card} field="maxDrawdownUsd" />
          </dd>
        </div>
        <div>
          <dt className="text-faint">체결 수</dt>
          <dd className="num mt-0.5">{card.metrics.fills}</dd>
        </div>
        <div>
          <dt className="text-faint">추가 Builder Fee</dt>
          <dd className="num mt-0.5">{feeLabel(card.feeTenthsBp)}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs">
        <span className="num text-muted">개발자 {shortAddress(card.ownerWalletAddress)}</span>
        <span className="flex gap-1.5">
          <RiskBadge level={card.riskLevel} />
          {card.status === "PAUSED" && <Badge tone="warn">일시 중지</Badge>}
        </span>
      </div>
    </Link>
  );
}

/** Fee disclosure required on bot detail and order confirmation. */
export function FeeBreakdown({ feeTenthsBp, builder, notional = 10_000 }: { feeTenthsBp: number; builder: string | null; notional?: number }) {
  const e = estimateFees(notional, feeTenthsBp);
  return (
    <div className="space-y-3 text-sm">
      <table className="w-full text-left">
        <tbody className="divide-y divide-line">
          <tr>
            <td className="py-2 text-muted">Hyperliquid 기본 수수료 (Tier 0)</td>
            <td className="num py-2 text-right">
              taker {HL_BASE_PERP_FEE.taker.mul(100).toFixed()}% / maker {HL_BASE_PERP_FEE.maker.mul(100).toFixed()}%
            </td>
          </tr>
          <tr>
            <td className="py-2 text-muted">이 봇의 추가 Builder Fee</td>
            <td className="num py-2 text-right font-semibold text-accent">{feeLabel(feeTenthsBp)}</td>
          </tr>
          <tr>
            <td className="py-2 text-muted">예시: 체결 금액 {usd(notional, 0)} 기준 예상 수수료 (taker)</td>
            <td className="num py-2 text-right">
              {usd(e.baseTakerFeeUsd)} + {usd(e.builderFeeUsd)} = <b>{usd(e.totalTakerUsd)}</b>
            </td>
          </tr>
        </tbody>
      </table>
      <ul className="space-y-1 text-xs text-muted">
        <li>• 기본 수수료는 Hyperliquid가 징수하며, 계정 등급·스테이킹·maker/taker에 따라 달라집니다. 확정 수수료는 체결 후 표시됩니다.</li>
        <li>
          • 추가 Builder Fee는 주문마다 플랫폼 Builder 주소({builder ? shortAddress(builder) : "미설정"})로 적립되며, 사용자가 서명으로 승인한
          상한을 넘을 수 없습니다.
        </li>
        <li>• 정산 확정된 Builder Fee의 70%는 봇 등록자, 30%는 관리자 배분 풀(플랫폼 6% · 1차 파트너 14.4% · 2차 파트너 9.6%)로 배분됩니다.</li>
      </ul>
    </div>
  );
}
