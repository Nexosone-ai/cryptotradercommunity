import Link from "next/link";
import { BotCard } from "@/components/bots";
import { Card, EmptyState, LinkButton, SectionTitle } from "@/components/ui";
import { listPublicBots, type PublicBotCard } from "@/lib/bots/queries";
import { getDb } from "@/lib/db/client";
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
  { t: "지갑 서명 로그인", d: "MetaMask 서명으로 본인 지갑을 인증합니다. 등록자 지갑 주소는 봇 페이지에 자동 공개됩니다." },
  { t: "봇 등록 · 위험 설정", d: "전략, 마켓, 레버리지, 손절·일일 손실 한도, 추가 Builder Fee율을 입력합니다." },
  { t: "운영자 심사", d: "위험 검사와 관리자 심사를 통과한 봇만 마켓에 공개됩니다." },
  { t: "실거래로 검증", d: "Hyperliquid 실체결 데이터만으로 성과를 집계하고, 데이터가 부족하면 그대로 표시합니다." },
];

export default async function Home() {
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
          누구나 자신의 트레이딩 봇을 등록하고, 검증된 거래 성과를 공개하며, Hyperliquid 유동성으로 거래하는 오픈 커뮤니티.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <HeroConnect />
          <LinkButton href="/bots" variant="secondary">
            봇 마켓 둘러보기
          </LinkButton>
          <LinkButton href="/bots/register" variant="ghost">
            내 봇 등록하기 →
          </LinkButton>
        </div>
      </section>

      <section>
        <SectionTitle title="실거래 검증 봇" desc="Hyperliquid 실체결 기준 검증 요건(청산 체결 20건·운영 14일 이상)을 충족한 봇만 표시합니다." />
        {bots === null ? (
          <EmptyState title="데이터베이스에 연결할 수 없습니다" desc="운영자가 DATABASE_URL 설정을 확인해야 합니다." />
        ) : verified.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {verified.map((b) => (
              <BotCard key={b.id} card={b} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="아직 실거래 검증을 통과한 봇이 없습니다"
            desc="검증 데이터가 쌓이기 전에는 수익률을 표시하지 않습니다. 가짜 수치나 백테스트를 실거래 성과로 보여주지 않습니다."
          />
        )}
      </section>

      <section>
        <SectionTitle title="신규 봇" action={<Link href="/bots" className="text-sm text-accent">전체 보기 →</Link>} />
        {newest.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {newest.map((b) => (
              <BotCard key={b.id} card={b} />
            ))}
          </div>
        ) : (
          <EmptyState title="공개된 봇이 아직 없습니다" desc="첫 번째 봇을 등록해 보세요." action={<LinkButton href="/bots/register">봇 등록하기</LinkButton>} />
        )}
      </section>

      <section>
        <SectionTitle title="위험 대비 성과를 보는 법" />
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <h3 className="font-semibold">순손익과 최대 낙폭을 함께</h3>
            <p className="mt-2 text-sm text-muted">순손익만 보지 말고 같은 기간의 최대 낙폭(MDD)과 레버리지를 함께 비교하세요.</p>
          </Card>
          <Card>
            <h3 className="font-semibold">지갑 전체 ≠ 봇 성과</h3>
            <p className="mt-2 text-sm text-muted">플랫폼이 봇 실행으로 보낸 주문(cloid)만 봇 성과에 포함합니다. 지갑의 다른 거래는 섞지 않습니다.</p>
          </Card>
          <Card>
            <h3 className="font-semibold">백테스트는 실거래가 아닙니다</h3>
            <p className="mt-2 text-sm text-muted">백테스트·자가 보고 실적은 별도 표시되며 랭킹과 검증 지표에 포함되지 않습니다.</p>
          </Card>
        </div>
      </section>

      <section>
        <SectionTitle title="봇 등록 프로세스" />
        <ol className="grid gap-4 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.t} className="rounded-xl border border-line bg-panel p-4">
              <span className="num text-xs text-accent">STEP {i + 1}</span>
              <h3 className="mt-2 font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="text-lg font-semibold">수수료 공개</h3>
          <p className="mt-2 text-sm text-muted">
            Hyperliquid 기본 거래 수수료는 Hyperliquid가 징수합니다. 플랫폼 수익은 사용자가 서명으로 승인한 상한 안에서 주문마다 붙는{" "}
            <b className="text-text">추가 Builder Fee</b>뿐이며, 정산 확정분의 70%는 봇 등록자에게, 30%는 관리자 배분 풀(플랫폼 6%·파트너
            24%)로 나뉩니다.
          </p>
          <Link href="/docs#fees" className="mt-3 inline-block text-sm text-accent">
            수수료 정책 자세히 →
          </Link>
        </Card>
        <Card>
          <h3 className="text-lg font-semibold">파트너 프로그램</h3>
          <p className="mt-2 text-sm text-muted">
            추천 링크로 가입한 트레이더의 플랫폼 경유 실체결에서 발생한 Builder Fee 중 1차 14.4%, 2차 9.6%가 파트너 몫으로 정산됩니다.
          </p>
          <Link href="/partners" className="mt-3 inline-block text-sm text-accent">
            파트너 안내 →
          </Link>
        </Card>
      </section>

      <section id="risk" className="rounded-xl border border-down/40 bg-down/5 p-5 text-sm leading-relaxed text-[#ffb4b4]">
        <h3 className="font-semibold text-down">위험 고지</h3>
        <p className="mt-2">
          가상자산 선물·레버리지 거래는 원금 전액 손실과 강제청산 위험이 있습니다. 자동매매는 시스템 장애, 네트워크 지연, 급격한 가격 변동으로
          예상과 다르게 동작할 수 있습니다. 공개된 과거 성과는 미래 수익을 보장하지 않으며, 플랫폼은 어떠한 수익도 보장하지 않습니다.
        </p>
      </section>
    </div>
  );
}
