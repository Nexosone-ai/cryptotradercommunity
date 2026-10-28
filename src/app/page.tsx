import Link from "next/link";
import { BotCard } from "@/components/bots";
import { Card, EmptyState, LinkButton, SectionTitle } from "@/components/ui";
import { listPublicBots, type PublicBotCard } from "@/lib/bots/queries";
import { getDb } from "@/lib/db/client";
import { getI18n } from "@/lib/i18n-server";
import { HeroConnect } from "./HeroConnect";

export const dynamic = "force-dynamic";

async function loadBots(): Promise<PublicBotCard[] | null> {
  try {
    return await listPublicBots(await getDb(), { sort: "newest" });
  } catch {
    return null;
  }
}

const STEPS = [
  {
    t: { en: "Sign in with your wallet", ko: "지갑 서명 로그인" },
    d: {
      en: "Verify your wallet with a MetaMask signature. The bot owner's wallet address is shown publicly on the bot page.",
      ko: "MetaMask 서명으로 본인 지갑을 인증합니다. 등록자 지갑 주소는 봇 페이지에 자동 공개됩니다.",
    },
  },
  {
    t: { en: "Register a bot · set risk limits", ko: "봇 등록 · 위험 설정" },
    d: {
      en: "Enter the strategy, market, leverage, stop loss, daily loss limit and additional Builder Fee rate.",
      ko: "전략, 마켓, 레버리지, 손절·일일 손실 한도, 추가 Builder Fee율을 입력합니다.",
    },
  },
  {
    t: { en: "Operator review", ko: "운영자 심사" },
    d: {
      en: "Only bots that pass the risk check and admin review are published to the market.",
      ko: "위험 검사와 관리자 심사를 통과한 봇만 마켓에 공개됩니다.",
    },
  },
  {
    t: { en: "Verified by live trading", ko: "실거래로 검증" },
    d: {
      en: "Performance is computed only from real Hyperliquid fills, and shown as-is when there isn't enough data.",
      ko: "Hyperliquid 실체결 데이터만으로 성과를 집계하고, 데이터가 부족하면 그대로 표시합니다.",
    },
  },
];

export default async function Home() {
  const { t } = await getI18n();
  const bots = await loadBots();
  const verified = bots?.filter((b) => b.metrics.verification === "VERIFIED_LIVE").slice(0, 3) ?? [];
  const newest = bots?.slice(0, 6) ?? [];

  return (
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-2xl border border-line bg-[radial-gradient(ellipse_at_top_right,rgba(25,211,197,0.16),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(59,130,246,0.14),transparent_50%)] px-6 py-14 sm:px-12 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Non-custodial · Hyperliquid perps</p>
        <h1 className="mt-4 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          Build a Bot. Prove Performance. Trade Together.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-muted sm:text-lg">
          {t(
            "An open community where anyone can register their own trading bot, publish verified trading performance and trade on Hyperliquid liquidity.",
            "누구나 자신의 트레이딩 봇을 등록하고, 검증된 거래 성과를 공개하며, Hyperliquid 유동성으로 거래하는 오픈 커뮤니티.",
          )}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <HeroConnect />
          <LinkButton href="/bots" variant="secondary">
            {t("Browse the bot market", "봇 마켓 둘러보기")}
          </LinkButton>
          <LinkButton href="/bots/register" variant="ghost">
            {t("Register your bot →", "내 봇 등록하기 →")}
          </LinkButton>
        </div>
      </section>

      <section>
        <SectionTitle
          title={t("Live-verified bots", "실거래 검증 봇")}
          desc={t(
            "Only bots that meet the verification requirements on real Hyperliquid fills (20 closing fills and at least 14 days of operation) are shown.",
            "Hyperliquid 실체결 기준 검증 요건(청산 체결 20건·운영 14일 이상)을 충족한 봇만 표시합니다.",
          )}
        />
        {bots === null ? (
          <EmptyState
            title={t("Can't connect to the database", "데이터베이스에 연결할 수 없습니다")}
            desc={t("The operator needs to check the DATABASE_URL setting.", "운영자가 DATABASE_URL 설정을 확인해야 합니다.")}
          />
        ) : verified.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {verified.map((b) => (
              <BotCard key={b.id} card={b} />
            ))}
          </div>
        ) : (
          <EmptyState
            title={t("No bot has passed live verification yet", "아직 실거래 검증을 통과한 봇이 없습니다")}
            desc={t(
              "Returns aren't shown until enough verified data has accumulated. We never present fake numbers or backtests as live performance.",
              "검증 데이터가 쌓이기 전에는 수익률을 표시하지 않습니다. 가짜 수치나 백테스트를 실거래 성과로 보여주지 않습니다.",
            )}
          />
        )}
      </section>

      <section>
        <SectionTitle
          title={t("New bots", "신규 봇")}
          action={
            <Link href="/bots" className="text-sm text-accent">
              {t("View all →", "전체 보기 →")}
            </Link>
          }
        />
        {newest.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {newest.map((b) => (
              <BotCard key={b.id} card={b} />
            ))}
          </div>
        ) : (
          <EmptyState
            title={t("No bots have been published yet", "공개된 봇이 아직 없습니다")}
            desc={t("Be the first to register one.", "첫 번째 봇을 등록해 보세요.")}
            action={<LinkButton href="/bots/register">{t("Register a bot", "봇 등록하기")}</LinkButton>}
          />
        )}
      </section>

      <section>
        <SectionTitle title={t("How to read risk-adjusted performance", "위험 대비 성과를 보는 법")} />
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <h3 className="font-semibold">{t("Net PnL together with max drawdown", "순손익과 최대 낙폭을 함께")}</h3>
            <p className="mt-2 text-sm text-muted">
              {t(
                "Don't look at net PnL alone: compare it with the maximum drawdown (MDD) and leverage over the same period.",
                "순손익만 보지 말고 같은 기간의 최대 낙폭(MDD)과 레버리지를 함께 비교하세요.",
              )}
            </p>
          </Card>
          <Card>
            <h3 className="font-semibold">{t("Whole wallet ≠ bot performance", "지갑 전체 ≠ 봇 성과")}</h3>
            <p className="mt-2 text-sm text-muted">
              {t(
                "Only orders the platform sent while running the bot (cloid) count toward bot performance. Other trades in the wallet are never mixed in.",
                "플랫폼이 봇 실행으로 보낸 주문(cloid)만 봇 성과에 포함합니다. 지갑의 다른 거래는 섞지 않습니다.",
              )}
            </p>
          </Card>
          <Card>
            <h3 className="font-semibold">{t("A backtest is not live trading", "백테스트는 실거래가 아닙니다")}</h3>
            <p className="mt-2 text-sm text-muted">
              {t(
                "Backtests and self-reported results are labeled separately and never count toward rankings or verified metrics.",
                "백테스트·자가 보고 실적은 별도 표시되며 랭킹과 검증 지표에 포함되지 않습니다.",
              )}
            </p>
          </Card>
        </div>
      </section>

      <section>
        <SectionTitle title={t("How bot registration works", "봇 등록 프로세스")} />
        <ol className="grid gap-4 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.t.en} className="rounded-xl border border-line bg-panel p-4">
              <span className="num text-xs text-accent">STEP {i + 1}</span>
              <h3 className="mt-2 font-semibold">{t(s.t.en, s.t.ko)}</h3>
              <p className="mt-2 text-sm text-muted">{t(s.d.en, s.d.ko)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="text-lg font-semibold">{t("Fee disclosure", "수수료 공개")}</h3>
          <p className="mt-2 text-sm text-muted">
            {t(
              <>
                Hyperliquid&apos;s base trading fees are collected by Hyperliquid. The platform&apos;s only revenue is the{" "}
                <b className="text-text">additional Builder Fee</b> added to each order within the cap you approved with your signature.
                Of the confirmed (settled) amount, 70% goes to the bot owner and 30% to the admin allocation pool (platform 6%, partners
                24%).
              </>,
              <>
                Hyperliquid 기본 거래 수수료는 Hyperliquid가 징수합니다. 플랫폼 수익은 사용자가 서명으로 승인한 상한 안에서 주문마다 붙는{" "}
                <b className="text-text">추가 Builder Fee</b>뿐이며, 정산 확정분의 70%는 봇 등록자에게, 30%는 관리자 배분 풀(플랫폼 6%·파트너
                24%)로 나뉩니다.
              </>,
            )}
          </p>
          <Link href="/docs#fees" className="mt-3 inline-block text-sm text-accent">
            {t("Fee policy details →", "수수료 정책 자세히 →")}
          </Link>
        </Card>
        <Card>
          <h3 className="text-lg font-semibold">{t("Partner program", "파트너 프로그램")}</h3>
          <p className="mt-2 text-sm text-muted">
            {t(
              "Of the Builder Fee generated by real fills placed through the platform by traders who signed up with a referral link, 14.4% (tier-1) and 9.6% (tier-2) is settled to partners.",
              "추천 링크로 가입한 트레이더의 플랫폼 경유 실체결에서 발생한 Builder Fee 중 1차 14.4%, 2차 9.6%가 파트너 몫으로 정산됩니다.",
            )}
          </p>
          <Link href="/partners" className="mt-3 inline-block text-sm text-accent">
            {t("Partners →", "파트너 안내 →")}
          </Link>
        </Card>
      </section>

      <section id="risk" className="rounded-xl border border-down/40 bg-down/5 p-5 text-sm leading-relaxed text-[#ffb4b4]">
        <h3 className="font-semibold text-down">{t("Risk disclosure", "위험 고지")}</h3>
        <p className="mt-2">
          {t(
            <>
              Crypto futures and leveraged trading carry the risk of losing your entire principal and of forced liquidation. Automated
              trading can behave unexpectedly due to system failures, network latency or sudden price moves. Published past performance
              does not guarantee future returns, and the platform guarantees no profit of any kind.
            </>,
            <>
              가상자산 선물·레버리지 거래는 원금 전액 손실과 강제청산 위험이 있습니다. 자동매매는 시스템 장애, 네트워크 지연, 급격한 가격 변동으로
              예상과 다르게 동작할 수 있습니다. 공개된 과거 성과는 미래 수익을 보장하지 않으며, 플랫폼은 어떠한 수익도 보장하지 않습니다.
            </>,
          )}
        </p>
      </section>
    </div>
  );
}
