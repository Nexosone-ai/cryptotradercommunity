import type { Metadata } from "next";
import Link from "next/link";
import { RiskBadge, VerificationBadge } from "@/components/bots";
import { EmptyState, Notice, SectionTitle } from "@/components/ui";
import { listPublicBots } from "@/lib/bots/queries";
import { getDb } from "@/lib/db/client";
import { feeLabel, usd } from "@/lib/format";
import { MIN_CLOSING_TRADES, MIN_DAYS } from "@/lib/performance/metrics";

export const metadata: Metadata = { title: "랭킹" };
export const dynamic = "force-dynamic";

export default async function RankingsPage() {
  const all = await listPublicBots(await getDb(), { sort: "pnl" });
  const ranked = all.filter((b) => b.metrics.verification === "VERIFIED_LIVE");
  const unranked = all.filter((b) => b.metrics.verification !== "VERIFIED_LIVE");

  return (
    <div className="space-y-6">
      <SectionTitle
        title="봇 랭킹"
        desc={`실거래 검증(청산 체결 ${MIN_CLOSING_TRADES}건·운영 ${MIN_DAYS}일 이상)을 통과한 봇만 순위에 오릅니다. 백테스트·자가 보고 실적은 제외됩니다.`}
      />
      <Notice tone="info">순위는 누적 순실현손익(USDC) 기준이며 최대 낙폭을 함께 확인하세요. 과거 성과는 미래 수익을 보장하지 않습니다.</Notice>
      {ranked.length === 0 ? (
        <EmptyState title="아직 순위에 오를 수 있는 검증 봇이 없습니다" desc="검증 기준을 충족하기 전에는 임의의 순위나 수익률을 만들지 않습니다." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-panel-2 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">봇</th>
                <th className="px-3 py-2 text-right">순손익</th>
                <th className="px-3 py-2 text-right">최대 낙폭</th>
                <th className="px-3 py-2 text-right">승률</th>
                <th className="px-3 py-2 text-right">청산 체결</th>
                <th className="px-3 py-2 text-right">수수료</th>
                <th className="px-3 py-2">위험</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line">
              {ranked.map((b, i) => (
                <tr key={b.id}>
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2 font-sans">
                    <Link href={`/bots/${b.slug}`} className="hover:text-accent">
                      {b.name}
                    </Link>
                  </td>
                  <td className={`px-3 py-2 text-right ${Number(b.metrics.netPnlUsd) >= 0 ? "text-up" : "text-down"}`}>{usd(b.metrics.netPnlUsd)}</td>
                  <td className="px-3 py-2 text-right text-down">{usd(-Number(b.metrics.maxDrawdownUsd))}</td>
                  <td className="px-3 py-2 text-right">{b.metrics.winRate}%</td>
                  <td className="px-3 py-2 text-right">{b.metrics.closingTrades}</td>
                  <td className="px-3 py-2 text-right">{feeLabel(b.feeTenthsBp)}</td>
                  <td className="px-3 py-2 font-sans">
                    <RiskBadge level={b.riskLevel} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unranked.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted">순위 미산정 (검증 데이터 부족)</h3>
          <ul className="flex flex-wrap gap-2">
            {unranked.map((b) => (
              <li key={b.id}>
                <Link href={`/bots/${b.slug}`} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent/50">
                  {b.name} <VerificationBadge v={b.metrics.verification} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
