import type { Metadata } from "next";
import Link from "next/link";
import { BotCard, RiskBadge, VerificationBadge } from "@/components/bots";
import { buttonClass, EmptyState, LinkButton, SectionTitle } from "@/components/ui";
import { listPublicBots, type BotListFilter } from "@/lib/bots/queries";
import { STRATEGY_LABELS, STRATEGY_TYPES } from "@/lib/bots/schema";
import { getDb } from "@/lib/db/client";
import { feeLabel, shortAddress, usd } from "@/lib/format";
import { getI18n } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Bot market", "봇 마켓") };
}
export const dynamic = "force-dynamic";

const SORTS = [
  ["newest", "Newest live", "최신 운영 시작"],
  ["pnl", "Verified net PnL", "검증 순손익"],
  ["drawdown", "Lowest max drawdown", "낮은 최대 낙폭"],
  ["risk", "Lowest risk", "낮은 위험도"],
  ["fee", "Lowest fee", "낮은 수수료"],
] as const;

export default async function BotsPage({ searchParams }: PageProps<"/bots">) {
  const sp = await searchParams;
  const { t, L } = await getI18n();
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filter: BotListFilter = {
    q: str("q")?.slice(0, 60),
    strategy: STRATEGY_TYPES.includes(str("strategy") as never) ? str("strategy") : undefined,
    market: str("market")?.toUpperCase(),
    verifiedOnly: str("verified") === "1",
    maxFeeTenthsBp: str("maxFee") ? Number(str("maxFee")) : undefined,
    sort: (SORTS.find(([k]) => k === str("sort"))?.[0] ?? "newest") as BotListFilter["sort"],
  };
  const view = str("view") === "table" ? "table" : "cards";
  const bots = await listPublicBots(await getDb(), filter);
  const toggleHref = (v: string) => {
    const params = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]);
    params.set("view", v);
    return `/bots?${params}`;
  };

  return (
    <div className="space-y-6">
      <SectionTitle
        title={t("Bot market", "봇 마켓")}
        desc={t(
          "Only bots that passed operator review are listed. Performance is based on actual Hyperliquid fills, and no figures are shown when there isn't enough verified data.",
          "운영자 심사를 통과한 봇만 공개됩니다. 성과는 Hyperliquid 실체결 기준이며 검증 데이터가 부족하면 수치를 표시하지 않습니다.",
        )}
        action={<LinkButton href="/bots/register">{t("Register a bot", "봇 등록")}</LinkButton>}
      />

      <form className="grid gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2 lg:grid-cols-6" method="get">
        <div className="lg:col-span-2">
          <label htmlFor="q">{t("Search (name, description, wallet)", "검색 (이름·설명·지갑)")}</label>
          <input id="q" name="q" defaultValue={filter.q} placeholder={t("e.g. trend, 0x12…", "예: trend, 0x12…")} />
        </div>
        <div>
          <label htmlFor="strategy">{t("Strategy", "전략")}</label>
          <select id="strategy" name="strategy" defaultValue={filter.strategy ?? ""}>
            <option value="">{t("All", "전체")}</option>
            {STRATEGY_TYPES.map((s) => (
              <option key={s} value={s}>
                {L(STRATEGY_LABELS[s])}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="market">{t("Market", "마켓")}</label>
          <input id="market" name="market" defaultValue={filter.market} placeholder="BTC-PERP" />
        </div>
        <div>
          <label htmlFor="maxFee">{t("Max additional fee", "최대 추가 수수료")}</label>
          <select id="maxFee" name="maxFee" defaultValue={str("maxFee") ?? ""}>
            <option value="">{t("No limit", "제한 없음")}</option>
            <option value="10">≤ 0.01%</option>
            <option value="20">≤ 0.02%</option>
            <option value="50">≤ 0.05%</option>
          </select>
        </div>
        <div>
          <label htmlFor="sort">{t("Sort", "정렬")}</label>
          <select id="sort" name="sort" defaultValue={filter.sort}>
            {SORTS.map(([k, en, ko]) => (
              <option key={k} value={k}>
                {t(en, ko)}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 lg:col-span-2">
          <input type="checkbox" name="verified" value="1" defaultChecked={filter.verifiedOnly} /> {t("Live-verified bots only", "실거래 검증 봇만")}
        </label>
        <input type="hidden" name="view" value={view} />
        <div className="flex gap-2 lg:col-span-4 lg:justify-end">
          <button className={buttonClass("primary", "sm")}>{t("Apply", "적용")}</button>
          <Link href="/bots" className={buttonClass("ghost", "sm")}>
            {t("Reset", "초기화")}
          </Link>
        </div>
      </form>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{t(`${bots.length} bots`, `${bots.length}개 봇`)}</span>
        <div className="flex gap-1 rounded-lg border border-line p-1">
          <Link href={toggleHref("cards")} className={`rounded px-3 py-1 ${view === "cards" ? "bg-panel-2" : "text-muted"}`}>
            {t("Cards", "카드")}
          </Link>
          <Link href={toggleHref("table")} className={`rounded px-3 py-1 ${view === "table" ? "bg-panel-2" : "text-muted"}`}>
            {t("Table", "표")}
          </Link>
        </div>
      </div>

      {bots.length === 0 ? (
        <EmptyState
          title={t("No bots match these filters", "조건에 맞는 봇이 없습니다")}
          desc={t("Try different filters or register your own bot.", "필터를 바꾸거나 직접 봇을 등록해 보세요.")}
        />
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bots.map((b) => (
            <BotCard key={b.id} card={b} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-panel-2 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">{t("Bot", "봇")}</th>
                <th className="px-3 py-2">{t("Verification", "검증")}</th>
                <th className="px-3 py-2 text-right">{t("Net PnL", "순손익")}</th>
                <th className="px-3 py-2 text-right">{t("Max drawdown", "최대 낙폭")}</th>
                <th className="px-3 py-2 text-right">{t("Fills", "체결")}</th>
                <th className="px-3 py-2 text-right">{t("Fee", "수수료")}</th>
                <th className="px-3 py-2">{t("Risk", "위험")}</th>
                <th className="px-3 py-2">{t("Developer", "개발자")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {bots.map((b) => {
                const ok = b.metrics.verification === "VERIFIED_LIVE";
                return (
                  <tr key={b.id} className="hover:bg-panel">
                    <td className="px-3 py-2">
                      <Link href={`/bots/${b.slug}`} className="font-medium hover:text-accent">
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <VerificationBadge v={b.metrics.verification} />
                    </td>
                    <td className="num px-3 py-2 text-right">{ok ? usd(b.metrics.netPnlUsd) : "—"}</td>
                    <td className="num px-3 py-2 text-right">{ok ? usd(-Number(b.metrics.maxDrawdownUsd)) : "—"}</td>
                    <td className="num px-3 py-2 text-right">{b.metrics.fills}</td>
                    <td className="num px-3 py-2 text-right">{feeLabel(b.feeTenthsBp)}</td>
                    <td className="px-3 py-2">
                      <RiskBadge level={b.riskLevel} />
                    </td>
                    <td className="num px-3 py-2 text-muted">{shortAddress(b.ownerWalletAddress)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
