import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddressLink } from "@/components/AddressLink";
import { FeeBreakdown, RiskBadge, VerificationBadge } from "@/components/bots";
import { Badge, buttonClass, Card, Notice, Stat } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current";
import { assessBotRisk } from "@/lib/bots/risk";
import { EXECUTION_LABELS, STRATEGY_LABELS, type BotConfig } from "@/lib/bots/schema";
import { getBotForViewer, getBotSource, listBotVersions } from "@/lib/bots/service";
import { BotSourcePanel } from "@/components/BotSourcePanel";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { botSubscriptions } from "@/lib/db/schema";
import { dateTime, feeLabel, STATUS_LABELS, usd } from "@/lib/format";
import { botFills, computeMetrics } from "@/lib/performance/metrics";
import { and, eq } from "drizzle-orm";
import { OwnerActions, SubscribePanel } from "./BotActions";
import { PnlChart } from "./PnlChart";

export const dynamic = "force-dynamic";

const PERIODS = { "7d": 7, "30d": 30, "90d": 90, all: undefined } as const;

function sinceDays(days: number | undefined) {
  return days ? new Date(Date.now() - days * 86_400_000) : undefined;
}

export async function generateMetadata({ params }: PageProps<"/bots/[id]">): Promise<Metadata> {
  const { id } = await params;
  const found = await getBotForViewer(await getDb(), id, null).catch(() => null);
  return { title: found?.bot.name ?? "봇 상세" };
}

export default async function BotDetail({ params, searchParams }: PageProps<"/bots/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const db = await getDb();
  const viewer = await getCurrentUser();
  const found = await getBotForViewer(db, id, viewer);
  if (!found) notFound();
  const { bot, isOwner, isAdmin } = found;
  const cfg = getConfig();
  const config = bot.config as BotConfig;
  const periodKey = (typeof sp.period === "string" && sp.period in PERIODS ? sp.period : "all") as keyof typeof PERIODS;
  const days = PERIODS[periodKey];
  const fills = await botFills(db, bot.id, sinceDays(days));
  const m = computeMetrics(fills);
  const verified = m.verification === "VERIFIED_LIVE";
  const risk = assessBotRisk(config, cfg.platformMaxFeeTenthsBp);
  const [sub] = viewer
    ? await db
        .select()
        .from(botSubscriptions)
        .where(and(eq(botSubscriptions.botId, bot.id), eq(botSubscriptions.userId, viewer.id), eq(botSubscriptions.network, cfg.network)))
        .limit(1)
    : [];
  const versions = isOwner || isAdmin ? await listBotVersions(db, bot.id) : [];
  const source = await getBotSource(db, bot, viewer);
  const curve = fills
    .slice()
    .sort((a, b) => a.time.getTime() - b.time.getTime())
    .reduce<{ time: number; value: number }[]>((acc, f) => {
      const prev = acc.at(-1)?.value ?? 0;
      const v = prev + Number(f.closedPnl) - Number(f.fee) - Number(f.builderFee ?? 0);
      acc.push({ time: Math.floor(f.time.getTime() / 1000), value: Number(v.toFixed(4)) });
      return acc;
    }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{bot.name}</h1>
            <VerificationBadge v={m.verification} />
            <RiskBadge level={bot.riskLevel} />
            {bot.status !== "LIVE" && <Badge tone="warn">{STATUS_LABELS[bot.status]}</Badge>}
          </div>
          <p className="mt-2 max-w-3xl text-muted">{bot.summary}</p>
          <div className="mt-3 text-sm">
            <span className="text-muted">개발자 지갑 (서명 검증됨) </span>
            <AddressLink address={bot.ownerWalletAddress} network={cfg.network} full />
          </div>
        </div>
      </div>

      {(isOwner || isAdmin) && bot.status !== "LIVE" && bot.status !== "PAUSED" && (
        <Notice tone="info">이 봇은 공개 상태가 아닙니다 ({STATUS_LABELS[bot.status]}). 소유자와 관리자만 볼 수 있습니다.</Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">실거래 성과</h2>
              <div className="flex gap-1 text-xs">
                {Object.keys(PERIODS).map((p) => (
                  <Link
                    key={p}
                    href={`/bots/${bot.slug}?period=${p}`}
                    className={`rounded px-2.5 py-1 ${p === periodKey ? "bg-panel-2 text-text" : "text-muted"}`}
                  >
                    {p === "all" ? "누적" : p}
                  </Link>
                ))}
              </div>
            </div>
            {!verified && (
              <Notice tone="info">
                검증 데이터 부족 — 청산 체결 {m.closingTrades}건 (기준 20건), 첫 체결{" "}
                {m.firstTradeAt ? dateTime(m.firstTradeAt) : "없음"}. 기준 충족 전에는 수익률·순위를 표시하지 않습니다.
              </Notice>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="순손익 (실현)" value={verified ? usd(m.netPnlUsd) : "—"} tone={verified ? (Number(m.netPnlUsd) >= 0 ? "up" : "down") : undefined} />
              <Stat label="최대 낙폭 (USDC)" value={verified ? usd(-Number(m.maxDrawdownUsd)) : "—"} />
              <Stat label="승률" value={verified && m.winRate ? `${m.winRate}%` : "—"} hint={`${m.wins}승 ${m.losses}패`} />
              <Stat label="손익비" value={verified && m.avgWinLossRatio ? m.avgWinLossRatio : "—"} />
              <Stat label="체결 수" value={m.fills} />
              <Stat label="누적 거래대금" value={usd(m.volumeUsd, 0)} />
              <Stat label="수수료 합계" value={usd(m.feesUsd)} />
              <Stat label="수익률 (ROI)" value="—" hint="자본 귀속 방식 확정 후 제공 (Phase 2)" />
            </div>
            <div className="mt-4">
              {verified && curve.length > 1 ? (
                <PnlChart data={curve} />
              ) : (
                <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-line-strong text-sm text-faint">
                  검증된 실거래 데이터가 쌓이면 누적 순손익 곡선이 표시됩니다.
                </div>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-faint">{m.methodology}</p>
          </Card>

          <Card>
            <h2 className="font-semibold">전략 설명</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">전략</dt>
                <dd>{STRATEGY_LABELS[config.strategyType]}</dd>
              </div>
              <div>
                <dt className="text-muted">마켓</dt>
                <dd>{config.markets.join(", ")}</dd>
              </div>
              <div>
                <dt className="text-muted">방향</dt>
                <dd>{{ LONG: "롱", SHORT: "숏", BOTH: "롱/숏" }[config.direction]}</dd>
              </div>
              <div>
                <dt className="text-muted">레버리지</dt>
                <dd className="num">
                  {config.leverageMin}x – {config.leverageMax}x
                </dd>
              </div>
              <div>
                <dt className="text-muted">타임프레임</dt>
                <dd>{config.timeframe}</dd>
              </div>
              <div>
                <dt className="text-muted">실행 방식</dt>
                <dd>{EXECUTION_LABELS[config.executionMode]}</dd>
              </div>
            </dl>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-text/90">{config.description}</p>
            <p className="mt-3 text-xs text-faint">공개 범위: 지갑 주소·설정·실거래 성과. 소스코드는 개발자가 공개로 설정한 경우에만 보입니다.</p>
          </Card>

          {source ? (
            <Card>
              <h2 className="mb-3 font-semibold">전략 소스코드</h2>
              <BotSourcePanel meta={source.meta} code={source.code} />
            </Card>
          ) : (
            isOwner && (
              <Card>
                <h2 className="mb-2 font-semibold">전략 소스코드</h2>
                <p className="text-sm text-muted">첨부된 소스코드가 없습니다. Pine Script 등 전략 코드를 심사용으로 첨부할 수 있습니다(기본 비공개).</p>
                <Link href={`/bots/register?edit=${bot.id}&step=source`} className={`mt-3 inline-flex ${buttonClass("secondary", "sm")}`}>
                  소스코드 첨부
                </Link>
              </Card>
            )
          )}

          <Card>
            <h2 className="font-semibold">최근 체결 (이 봇의 주문만)</h2>
            {fills.length === 0 ? (
              <p className="mt-3 text-sm text-muted">아직 이 봇으로 귀속된 체결이 없습니다.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="py-1.5">시간</th>
                      <th>마켓</th>
                      <th>방향</th>
                      <th className="text-right">가격</th>
                      <th className="text-right">수량</th>
                      <th className="text-right">실현손익</th>
                    </tr>
                  </thead>
                  <tbody className="num divide-y divide-line">
                    {fills.slice(-20).reverse().map((f, i) => (
                      <tr key={i}>
                        <td className="py-1.5">{dateTime(f.time)}</td>
                        <td>{f.coin}</td>
                        <td className={f.side === "B" ? "text-up" : "text-down"}>{f.side === "B" ? "매수" : "매도"}</td>
                        <td className="text-right">{f.price}</td>
                        <td className="text-right">{f.size}</td>
                        <td className={`text-right ${Number(f.closedPnl) >= 0 ? "text-up" : "text-down"}`}>{f.closedPnl}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">참여</h2>
            {isOwner ? (
              <OwnerActions botId={bot.id} status={bot.status} />
            ) : (
              <SubscribePanel
                botId={bot.id}
                live={bot.status === "LIVE"}
                feeTenthsBp={bot.feeTenthsBp}
                subscription={sub ? { status: sub.status, acceptedFeeTenthsBp: sub.acceptedFeeTenthsBp, pendingFeeTenthsBp: sub.pendingFeeTenthsBp } : null}
              />
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">수수료 구성</h2>
            <FeeBreakdown feeTenthsBp={bot.feeTenthsBp} builder={cfg.builderAddress} />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">위험 정책</h2>
            <dl className="num space-y-2 text-sm">
              <Row k="1회 최대 주문" v={usd(config.risk.maxOrderUsd, 0)} />
              <Row k="최대 포지션 규모" v={usd(config.risk.maxPositionUsd, 0)} />
              <Row k="최대 레버리지" v={`${config.risk.maxLeverage}x`} />
              <Row k="손절" v={`${config.risk.stopLossPct}%`} />
              <Row k="일일 손실 한도" v={usd(config.risk.dailyLossLimitUsd, 0)} />
              <Row k="긴급 중단" v="지원" />
            </dl>
            {risk.findings.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-warn">
                {risk.findings.map((f) => (
                  <li key={f.code}>⚠ {f.message}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">개발자</h2>
            <p className="text-sm text-muted">{config.developer.bio || "소개가 없습니다."}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {config.developer.blogUrl && <ExtLink href={config.developer.blogUrl} label="블로그" />}
              {config.developer.xUrl && <ExtLink href={config.developer.xUrl} label="X" />}
              {config.developer.telegramUrl && <ExtLink href={config.developer.telegramUrl} label="Telegram" />}
            </div>
            <p className="mt-3 text-xs text-faint">
              운영 시작 {bot.liveSince ? dateTime(bot.liveSince) : "—"} · 설정 버전 v{bot.configVersion} · 추가 수수료 {feeLabel(bot.feeTenthsBp)}
            </p>
          </Card>

          {versions.length > 0 && (
            <Card>
              <h2 className="mb-3 font-semibold">변경 이력 (소유자·관리자만)</h2>
              <ul className="space-y-2 text-xs">
                {versions.map((v) => (
                  <li key={v.id} className="flex justify-between gap-2">
                    <span>
                      v{v.version} · {v.changeNote} · 수수료 {feeLabel(v.feeTenthsBp)}
                    </span>
                    <span className="num text-faint">{dateTime(v.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function ExtLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
      {label} ↗
    </a>
  );
}
