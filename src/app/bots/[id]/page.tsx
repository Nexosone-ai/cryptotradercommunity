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
import { getI18n } from "@/lib/i18n-server";
import { and, eq } from "drizzle-orm";
import { getHlGateway } from "@/lib/hyperliquid/gateway";
import { engineAvailability, recentExecutions, recentSignals } from "@/lib/engine/execute";
import { subscriberReadiness } from "@/lib/engine/readiness";
import { TREND_TEMPLATE, usesTrendTemplate } from "@/lib/engine/trend";
import { OwnerActions, PublishBanner, SubscribePanel } from "./BotActions";
import { ReadinessList, TradeAmount, WebhookSetup } from "./EngineParts";
import { PnlChart } from "./PnlChart";

export const dynamic = "force-dynamic";

const PERIODS = { "7d": 7, "30d": 30, "90d": 90, all: undefined } as const;

function sinceDays(days: number | undefined) {
  return days ? new Date(Date.now() - days * 86_400_000) : undefined;
}

export async function generateMetadata({ params }: PageProps<"/bots/[id]">): Promise<Metadata> {
  const { id } = await params;
  const found = await getBotForViewer(await getDb(), id, null).catch(() => null);
  const { t } = await getI18n();
  return { title: found?.bot.name ?? t("Bot details", "봇 상세") };
}

export default async function BotDetail({ params, searchParams }: PageProps<"/bots/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { t, L } = await getI18n();
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
  const hl = getHlGateway(cfg.network);
  const readiness = viewer && sub && !isOwner ? await subscriberReadiness(db, hl, viewer, bot, sub) : null;
  const executions = sub && !isOwner ? await recentExecutions(db, sub.id) : [];
  const signals = isOwner || isAdmin ? await recentSignals(db, bot.id, cfg.network) : [];
  const engine = engineAvailability();
  const webhookBot = config.executionMode === "WEBHOOK_SIGNAL";
  const trendBot = usesTrendTemplate(config);
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
            {bot.status !== "LIVE" && <Badge tone="warn">{L(STATUS_LABELS[bot.status])}</Badge>}
          </div>
          <p className="mt-2 max-w-3xl text-muted">{bot.summary}</p>
          <div className="mt-3 text-sm">
            <span className="text-muted">{t("Developer wallet (signature-verified) ", "개발자 지갑 (서명 검증됨) ")}</span>
            <AddressLink address={bot.ownerWalletAddress} network={cfg.network} full />
          </div>
        </div>
      </div>

      {isOwner && bot.status === "APPROVED" ? (
        <PublishBanner botId={bot.id} />
      ) : isAdmin && bot.status === "APPROVED" ? (
        <Notice tone="info">
          {t(
            "Approved. It appears in the bot market only after the owner presses Publish to market (LIVE).",
            "승인됨. 소유자가 마켓에 공개 (LIVE)를 눌러야 봇 마켓에 노출됩니다.",
          )}
        </Notice>
      ) : (isOwner || isAdmin) && bot.status !== "LIVE" && bot.status !== "PAUSED" && (
        <Notice tone="info">
          {t(
            `This bot is not public (${L(STATUS_LABELS[bot.status])}). Only the owner and admins can see it.`,
            `이 봇은 공개 상태가 아닙니다 (${L(STATUS_LABELS[bot.status])}). 소유자와 관리자만 볼 수 있습니다.`,
          )}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{t("Live performance", "실거래 성과")}</h2>
              <div className="flex gap-1 text-xs">
                {Object.keys(PERIODS).map((p) => (
                  <Link
                    key={p}
                    href={`/bots/${bot.slug}?period=${p}`}
                    className={`rounded px-2.5 py-1 ${p === periodKey ? "bg-panel-2 text-text" : "text-muted"}`}
                  >
                    {p === "all" ? t("All time", "누적") : p}
                  </Link>
                ))}
              </div>
            </div>
            {!verified && (
              <Notice tone="info">
                {t(
                  <>
                    Not enough verified data — {m.closingTrades} closing fills (20 required), first fill{" "}
                    {m.firstTradeAt ? dateTime(m.firstTradeAt) : "none"}. Returns and rankings are hidden until the threshold is met.
                  </>,
                  <>
                    검증 데이터 부족 — 청산 체결 {m.closingTrades}건 (기준 20건), 첫 체결{" "}
                    {m.firstTradeAt ? dateTime(m.firstTradeAt) : "없음"}. 기준 충족 전에는 수익률·순위를 표시하지 않습니다.
                  </>,
                )}
              </Notice>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t("Net PnL (realized)", "순손익 (실현)")} value={verified ? usd(m.netPnlUsd) : "—"} tone={verified ? (Number(m.netPnlUsd) >= 0 ? "up" : "down") : undefined} />
              <Stat label={t("Max drawdown (USDC)", "최대 낙폭 (USDC)")} value={verified ? usd(-Number(m.maxDrawdownUsd)) : "—"} />
              <Stat
                label={t("Win rate", "승률")}
                value={verified && m.winRate ? `${m.winRate}%` : "—"}
                hint={t(`${m.wins}W ${m.losses}L`, `${m.wins}승 ${m.losses}패`)}
              />
              <Stat label={t("Win/loss ratio", "손익비")} value={verified && m.avgWinLossRatio ? m.avgWinLossRatio : "—"} />
              <Stat label={t("Fills", "체결 수")} value={m.fills} />
              <Stat label={t("Total volume", "누적 거래대금")} value={usd(m.volumeUsd, 0)} />
              <Stat label={t("Total fees", "수수료 합계")} value={usd(m.feesUsd)} />
              <Stat
                label={t("Return (ROI)", "수익률 (ROI)")}
                value="—"
                hint={t("Available once capital attribution is finalized (Phase 2)", "자본 귀속 방식 확정 후 제공 (Phase 2)")}
              />
            </div>
            <div className="mt-4">
              {verified && curve.length > 1 ? (
                <PnlChart data={curve} />
              ) : (
                <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-line-strong text-sm text-faint">
                  {t(
                    "A cumulative net PnL curve appears once verified live data accumulates.",
                    "검증된 실거래 데이터가 쌓이면 누적 순손익 곡선이 표시됩니다.",
                  )}
                </div>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-faint">{L(m.methodology)}</p>
          </Card>

          <Card>
            <h2 className="font-semibold">{t("Strategy", "전략 설명")}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">{t("Type", "전략")}</dt>
                <dd>{L(STRATEGY_LABELS[config.strategyType])}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("Markets", "마켓")}</dt>
                <dd>{config.markets.join(", ")}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("Direction", "방향")}</dt>
                <dd>{t({ LONG: "Long", SHORT: "Short", BOTH: "Long/short" }, { LONG: "롱", SHORT: "숏", BOTH: "롱/숏" })[config.direction]}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("Leverage", "레버리지")}</dt>
                <dd className="num">
                  {config.leverageMin}x – {config.leverageMax}x
                </dd>
              </div>
              <div>
                <dt className="text-muted">{t("Timeframe", "타임프레임")}</dt>
                <dd>{config.timeframe}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("Execution", "실행 방식")}</dt>
                <dd>{L(EXECUTION_LABELS[config.executionMode])}</dd>
              </div>
            </dl>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-text/90">{config.description}</p>
            <p className="mt-3 text-xs text-faint">
              {t(
                "Public: wallet address, settings and live performance. Source code is visible only if the developer made it public.",
                "공개 범위: 지갑 주소·설정·실거래 성과. 소스코드는 개발자가 공개로 설정한 경우에만 보입니다.",
              )}
            </p>
          </Card>

          {source ? (
            <Card>
              <h2 className="mb-3 font-semibold">{t("Strategy source code", "전략 소스코드")}</h2>
              <BotSourcePanel meta={source.meta} code={source.code} />
            </Card>
          ) : (
            isOwner && (
              <Card>
                <h2 className="mb-2 font-semibold">{t("Strategy source code", "전략 소스코드")}</h2>
                <p className="text-sm text-muted">
                  {t(
                    "No source code attached. You can attach strategy code such as Pine Script for review (private by default).",
                    "첨부된 소스코드가 없습니다. Pine Script 등 전략 코드를 심사용으로 첨부할 수 있습니다(기본 비공개).",
                  )}
                </p>
                <Link href={`/bots/register?edit=${bot.id}&step=source`} className={`mt-3 inline-flex ${buttonClass("secondary", "sm")}`}>
                  {t("Attach source code", "소스코드 첨부")}
                </Link>
              </Card>
            )
          )}

          <Card>
            <h2 className="font-semibold">{t("Recent fills (this bot's orders only)", "최근 체결 (이 봇의 주문만)")}</h2>
            {fills.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t("No fills attributed to this bot yet.", "아직 이 봇으로 귀속된 체결이 없습니다.")}</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="py-1.5">{t("Time", "시간")}</th>
                      <th>{t("Market", "마켓")}</th>
                      <th>{t("Side", "방향")}</th>
                      <th className="text-right">{t("Price", "가격")}</th>
                      <th className="text-right">{t("Size", "수량")}</th>
                      <th className="text-right">{t("Realized PnL", "실현손익")}</th>
                    </tr>
                  </thead>
                  <tbody className="num divide-y divide-line">
                    {fills.slice(-20).reverse().map((f, i) => (
                      <tr key={i}>
                        <td className="py-1.5">{dateTime(f.time)}</td>
                        <td>{f.coin}</td>
                        <td className={f.side === "B" ? "text-up" : "text-down"}>{f.side === "B" ? t("Buy", "매수") : t("Sell", "매도")}</td>
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
            <h2 className="mb-3 font-semibold">{t("Participate", "참여")}</h2>
            {isOwner ? (
              <OwnerActions botId={bot.id} status={bot.status} />
            ) : (
              <SubscribePanel
                botId={bot.id}
                live={bot.status === "LIVE"}
                feeTenthsBp={bot.feeTenthsBp}
                maxOrderUsd={config.risk.maxOrderUsd}
                subscription={sub ? { status: sub.status, acceptedFeeTenthsBp: sub.acceptedFeeTenthsBp, pendingFeeTenthsBp: sub.pendingFeeTenthsBp } : null}
              />
            )}
          </Card>

          {readiness && sub && (
            <Card>
              <h2 className="mb-3 font-semibold">Bot trading for you</h2>
              <div className="space-y-4 text-sm">
                <ReadinessList items={readiness} />
                {(sub.status === "ACTIVE" || sub.status === "REQUIRES_RECONSENT") && (
                  <TradeAmount botId={bot.id} orderUsd={sub.orderUsd} maxOrderUsd={config.risk.maxOrderUsd} />
                )}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Your recent bot activity</h3>
                  {executions.length === 0 ? (
                    <p className="text-muted">Nothing yet. Activity appears here when the bot sends a signal.</p>
                  ) : (
                    <ul className="space-y-2" data-testid="bot-executions">
                      {executions.map(({ e, action, coin }) => (
                        <li key={e.id} className="text-xs">
                          <span className="num text-muted">{dateTime(e.createdAt)}</span>{" "}
                          <Badge tone={e.status === "DONE" ? "up" : e.status === "FAILED" ? "down" : "neutral"}>{e.status}</Badge>{" "}
                          <b>
                            {action} {coin}
                          </b>
                          {e.reason && <span className="block text-muted">{e.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          )}

          {(isOwner || isAdmin) && (
            <Card>
              <h2 className="mb-3 font-semibold">Trading signals</h2>
              <div className="space-y-4 text-sm">
                {!engine.enabled && <Notice tone="warn">{engine.reason}</Notice>}
                {webhookBot ? (
                  isOwner ? (
                    <WebhookSetup
                      botId={bot.id}
                      signalUrl={new URL(`/api/bots/${bot.id}/signal`, cfg.appUrl).toString()}
                      hasToken={Boolean(bot.webhookSecretHash)}
                      coin={config.markets[0].replace(/-PERP$/, "")}
                    />
                  ) : (
                    <p className="text-muted">External signal webhook. Token set: {bot.webhookSecretHash ? "yes" : "no"}.</p>
                  )
                ) : trendBot ? (
                  <p className="text-muted">
                    Platform Trend Following template: EMA({TREND_TEMPLATE.fast}) / EMA({TREND_TEMPLATE.slow}) crossover on closed {config.timeframe} candles of{" "}
                    {config.markets.join(", ")}, checked every minute. A cross up goes long, a cross down goes short
                    {config.direction === "LONG" ? " (this long-only bot closes instead)" : config.direction === "SHORT" ? " (this short-only bot only shorts)" : ""}.
                  </p>
                ) : (
                  <Notice tone="warn">
                    This bot&apos;s execution mode ({L(EXECUTION_LABELS[config.executionMode])}, {STRATEGY_LABELS[config.strategyType]}) isn&apos;t automated yet, so it
                    places no orders. To trade now, edit the bot and choose External signal webhook (e.g. TradingView alerts from your Pine Script), or the
                    Trend Following template. Changing it sends the bot back to review.
                  </Notice>
                )}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent signals</h3>
                  {signals.length === 0 ? (
                    <p className="text-muted">No signals yet.</p>
                  ) : (
                    <ul className="space-y-2" data-testid="bot-signals">
                      {signals.map((s) => {
                        const sum = s.summary as { subscribers?: number; done?: number; skipped?: number; failed?: number } | null;
                        return (
                          <li key={s.id} className="text-xs">
                            <span className="num text-muted">{dateTime(s.createdAt)}</span>{" "}
                            <Badge tone={s.status === "PROCESSED" ? "up" : s.status === "FAILED" ? "down" : "neutral"}>{s.status}</Badge>{" "}
                            <b>
                              {s.action} {s.coin}
                            </b>{" "}
                            <span className="text-muted">({s.source.toLowerCase()})</span>
                            {sum && (
                              <span className="block text-muted">
                                {sum.subscribers} subscribers · {sum.done} traded · {sum.skipped} skipped · {sum.failed} failed
                              </span>
                            )}
                            {s.error && <span className="block text-warn">{s.error}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          )}

          <Card>
            <h2 className="mb-3 font-semibold">{t("Fee breakdown", "수수료 구성")}</h2>
            <FeeBreakdown feeTenthsBp={bot.feeTenthsBp} builder={cfg.builderAddress} />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">{t("Risk policy", "위험 정책")}</h2>
            <dl className="num space-y-2 text-sm">
              <Row k={t("Max per order", "1회 최대 주문")} v={usd(config.risk.maxOrderUsd, 0)} />
              <Row k={t("Max position size", "최대 포지션 규모")} v={usd(config.risk.maxPositionUsd, 0)} />
              <Row k={t("Max leverage", "최대 레버리지")} v={`${config.risk.maxLeverage}x`} />
              <Row k={t("Stop loss", "손절")} v={`${config.risk.stopLossPct}%`} />
              <Row k={t("Daily loss limit", "일일 손실 한도")} v={usd(config.risk.dailyLossLimitUsd, 0)} />
              <Row k={t("Emergency stop", "긴급 중단")} v={t("Supported", "지원")} />
            </dl>
            {risk.findings.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-warn">
                {risk.findings.map((f) => (
                  <li key={f.code}>⚠ {L(f.message)}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">{t("Developer", "개발자")}</h2>
            <p className="text-sm text-muted">{config.developer.bio || t("No bio.", "소개가 없습니다.")}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {config.developer.blogUrl && <ExtLink href={config.developer.blogUrl} label={t("Blog", "블로그")} />}
              {config.developer.xUrl && <ExtLink href={config.developer.xUrl} label="X" />}
              {config.developer.telegramUrl && <ExtLink href={config.developer.telegramUrl} label="Telegram" />}
            </div>
            <p className="mt-3 text-xs text-faint">
              {t(
                <>
                  Live since {bot.liveSince ? dateTime(bot.liveSince) : "—"} · config version v{bot.configVersion} · additional fee {feeLabel(bot.feeTenthsBp)}
                </>,
                <>
                  운영 시작 {bot.liveSince ? dateTime(bot.liveSince) : "—"} · 설정 버전 v{bot.configVersion} · 추가 수수료 {feeLabel(bot.feeTenthsBp)}
                </>,
              )}
            </p>
          </Card>

          {versions.length > 0 && (
            <Card>
              <h2 className="mb-3 font-semibold">{t("Change history (owner and admins only)", "변경 이력 (소유자·관리자만)")}</h2>
              <ul className="space-y-2 text-xs">
                {versions.map((v) => (
                  <li key={v.id} className="flex justify-between gap-2">
                    <span>
                      v{v.version} · {v.changeNote && L(v.changeNote)} · {t("fee", "수수료")} {feeLabel(v.feeTenthsBp)}
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
