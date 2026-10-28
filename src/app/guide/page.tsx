import type { Metadata } from "next";
import Link from "next/link";
import Decimal from "decimal.js";
import type { ReactNode } from "react";
import { Badge, Card, Notice } from "@/components/ui";
import { STRATEGY_LABELS, STRATEGY_TYPES } from "@/lib/bots/schema";
import { getConfig } from "@/lib/config";
import { feeLabel } from "@/lib/format";
import type { I18n } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t(
      "User guide — from sign-up to registering a bot and setting fees",
      "이용 가이드 — 가입부터 봇 등록·수수료 설정까지",
    ),
  };
}

const TOC = [
  ["ready", "0. Before you start", "0. 시작 전 준비물"],
  ["signup", "1. Sign up (log in with MetaMask)", "1. 가입하기 (MetaMask 로그인)"],
  ["register", "2. Register a bot (5 steps)", "2. 봇 등록하기 (5단계)"],
  ["fee", "3. Fee (commission) settings in detail", "3. 수수료(커미션) 설정 자세히"],
  ["review", "4. Review, publishing and running your bot", "4. 심사 · 마켓 공개 · 운영"],
  ["payout", "5. Earnings and payouts", "5. 수익 확인과 지급"],
  ["faq", "6. FAQ and troubleshooting", "6. 자주 묻는 질문 · 문제 해결"],
] as const;

const STRATEGY_HELP: Record<
  (typeof STRATEGY_TYPES)[number],
  { en: string; ko: string }
> = {
  TREND_FOLLOWING: {
    en: "Follows the trend. Uses moving averages, breakouts and similar signals to go long in rising markets and short in falling ones.",
    ko: "추세를 따라가는 전략. 이동평균·돌파 등으로 상승장엔 롱, 하락장엔 숏.",
  },
  GRID: {
    en: "Splits a price range into levels and repeatedly buys low and sells high within it. Suits sideways markets.",
    ko: "가격 구간을 여러 칸으로 나눠 아래에서 사고 위에서 파는 반복 매매. 횡보장에 적합.",
  },
  MARTINGALE: {
    en: "Increases position size after a loss. Risk grows very quickly during a losing streak, so review is strict.",
    ko: "손실 후 진입 규모를 키우는 전략. 연속 손실 시 위험이 급격히 커져 심사에서 엄격히 봅니다.",
  },
  TP_TRADING: {
    en: "Entries and exits built around take-profit targets.",
    ko: "목표가(Take Profit) 중심의 진입·청산 전략.",
  },
  ARBITRAGE: {
    en: "Profits from price differences. Approved only after we confirm it can actually execute once latency and fees are accounted for.",
    ko: "가격 차이를 이용하는 전략. 지연·수수료를 고려한 실행 가능성 검증 후에만 승인됩니다.",
  },
  CUSTOM: {
    en: "Anything that doesn't fit the categories above. Please explain in detail how it works in the description.",
    ko: "위 분류에 해당하지 않는 전략. 설명란에 동작 방식을 자세히 적어 주세요.",
  },
};

/** Builder Fee on a given notional at a fee rate in tenths of a basis point (display only). */
function feeOn(notionalUsd: number, tenthsBp: number) {
  return new Decimal(notionalUsd).mul(tenthsBp).div(100_000);
}
function usdc(d: Decimal) {
  return `${d.toDecimalPlaces(2).toNumber().toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
}

export default async function GuidePage() {
  const { t, L } = await getI18n();
  const cfg = getConfig();
  const chain = cfg.walletChain;
  const cap = cfg.platformMaxFeeTenthsBp;
  const viewOnly = cfg.network === "mainnet" && !cfg.mainnetTradingEnabled;
  const exampleRates = Array.from(
    new Set([10, 25, cap].filter((r) => r > 0 && r <= cap)),
  ).sort((a, b) => a - b);
  const monthly = 1_000_000;
  const exRate = Math.min(30, cap);
  const exFee = feeOn(monthly, exRate);

  return (
    <article className="mx-auto max-w-3xl space-y-10 text-sm leading-relaxed">
      <header className="space-y-3">
        <Badge tone="accent">{t("Beginner's manual", "초보자용 매뉴얼")}</Badge>
        <h1 className="text-2xl font-bold">
          {t(
            "User guide: from sign-up to registering a bot and setting fees",
            "이용 가이드: 가입부터 봇 등록 · 수수료 설정까지",
          )}
        </h1>
        <p className="text-muted">
          {t(
            "This guide is written so that even first-time visitors can follow along, using the exact button names you see on screen. There's no email or password sign-up: a single MetaMask wallet signature is both your sign-up and your login.",
            "처음 오신 분도 그대로 따라 할 수 있도록 화면에 보이는 버튼 이름 그대로 설명합니다. 이메일·비밀번호 회원가입은 없고, MetaMask 지갑 서명 한 번이 곧 가입이자 로그인입니다.",
          )}
        </p>
        {viewOnly && (
          <Notice tone="warn">
            {t(
              <>
                The service is currently in a{" "}
                <b>view-only Hyperliquid mainnet</b> phase. You can already sign
                up, register bots, go through review and give subscription
                consent, but real orders and trading permission (agent wallet)
                approval are not open yet. That means no bot orders are placed
                and no fee earnings are generated for now.
              </>,
              <>
                현재 서비스는 <b>Hyperliquid 메인넷 조회 전용</b> 단계입니다.
                가입·봇 등록·심사·구독 동의는 지금 할 수 있지만, 실제 주문과 거래
                권한(에이전트) 승인은 아직 열려 있지 않습니다. 따라서 지금은 봇
                주문·수수료 수익이 발생하지 않습니다.
              </>,
            )}
          </Notice>
        )}
        <Notice tone="info">
          {t(
            <>
              The automated trading worker ships in Phase 2. Until then,
              registered bots don&rsquo;t place real orders, and every
              bot&rsquo;s performance shows as &lsquo;Not enough verified
              data&rsquo;.
            </>,
            <>
              자동매매 실행 워커는 Phase 2에서 배포됩니다. 그 전에는 등록된 봇이
              실제로 주문을 내지 않으며, 모든 봇 성과는 &lsquo;검증 데이터
              부족&rsquo;으로 표시됩니다.
            </>,
          )}
        </Notice>
        <nav aria-label={t("Contents", "목차")}>
          <Card className="space-y-1">
            <p className="mb-1 font-semibold">{t("Contents", "목차")}</p>
            {TOC.map(([id, en, ko]) => (
              <a
                key={id}
                href={`#${id}`}
                className="block text-muted hover:text-text"
              >
                {t(en, ko)}
              </a>
            ))}
          </Card>
        </nav>
      </header>

      <Section id="ready" title={t("0. Before you start", "0. 시작 전 준비물")}>
        <ul className="list-inside list-disc space-y-1 text-muted">
          <li>
            {t(
              <>
                <b className="text-text">On a computer</b>: Chrome, Brave or
                Edge plus the{" "}
                <b className="text-text">MetaMask browser extension</b>{" "}
                (install it from metamask.io).
              </>,
              <>
                <b className="text-text">PC</b>: Chrome·Brave·Edge 브라우저 +{" "}
                <b className="text-text">MetaMask 확장 프로그램</b>(metamask.io에서
                설치).
              </>,
            )}
          </li>
          <li>
            {t(
              <>
                <b className="text-text">On a phone</b>: the{" "}
                <b className="text-text">MetaMask app</b> from the App Store or
                Google Play. On a phone, open the site inside the MetaMask
                app&rsquo;s built-in browser.
              </>,
              <>
                <b className="text-text">휴대폰</b>: App Store / Google Play의{" "}
                <b className="text-text">MetaMask 앱</b>. 휴대폰에서는 MetaMask 앱
                안의 브라우저로 사이트를 열어야 합니다.
              </>,
            )}
          </li>
          <li>
            {t(
              "A wallet (a brand-new one is fine). Signing in costs no gas, so you can sign up even with a zero balance.",
              "지갑 하나(새로 만들어도 됩니다). 로그인 서명은 가스비가 들지 않아 잔고가 0이어도 가입할 수 있습니다.",
            )}
          </li>
        </ul>
        <Notice tone="down">
          {t(
            <>
              When you first create a MetaMask wallet, write down the{" "}
              <b>Secret Recovery Phrase (12 words)</b> on paper and keep it
              offline. No website, including CryptoTraderCommunity, will ever ask
              for those 12 words or your private key. Any screen that asks for
              them is a phishing attempt, every time.
            </>,
            <>
              MetaMask를 처음 만들 때 나오는 <b>비밀복구구문(12단어)</b>은 종이에
              적어 오프라인에 보관하세요. CryptoTraderCommunity를 포함한 어떤
              사이트도 이 12단어나 개인키를 요구하지 않습니다. 요구하는 화면은 100%
              피싱입니다.
            </>,
          )}
        </Notice>
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer font-medium">
            {t(
              "Installing MetaMask for the first time? (expand)",
              "MetaMask를 처음 설치한다면 (펼치기)",
            )}
          </summary>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-muted">
            <li>
              {t(
                "metamask.io → Download → add the extension to your browser.",
                "metamask.io → Download → 브라우저에 확장 프로그램 추가.",
              )}
            </li>
            <li>
              {t(
                <>
                  Choose &lsquo;Create a new wallet&rsquo; → set a MetaMask
                  password (it only unlocks MetaMask on this device).
                </>,
                <>
                  &lsquo;새 지갑 생성&rsquo; → MetaMask 앱 비밀번호 설정(이 기기에서
                  잠금 해제용).
                </>,
              )}
            </li>
            <li>
              {t(
                "Write the 12-word Secret Recovery Phrase on paper in order, then enter it again at the confirmation step.",
                "비밀복구구문 12단어를 순서대로 종이에 적고, 확인 단계에서 다시 입력.",
              )}
            </li>
            <li>
              {t(
                "Tip: pin MetaMask from the puzzle-piece icon at the top right of your browser so it's always handy.",
                "브라우저 오른쪽 위 퍼즐 아이콘에서 MetaMask를 고정(핀)해 두면 편합니다.",
              )}
            </li>
          </ol>
        </details>
      </Section>

      <Section
        id="signup"
        title={t("1. Sign up (log in with MetaMask)", "1. 가입하기 (MetaMask 로그인)")}
      >
        <Card className="space-y-2">
          <p className="font-semibold">
            {t(
              "Got a referral (invite) link? Open that link first",
              "추천(초대) 링크가 있다면 — 먼저 그 링크로 접속하세요",
            )}
          </p>
          <p className="text-muted">
            {t(
              <>
                If you arrive through a <code className="num">…/ref/CODE</code>{" "}
                link from a partner, you&rsquo;ll see &lsquo;✓ Referral code
                saved.&rsquo; The referral is locked in{" "}
                <b className="text-text">
                  only once, at that wallet&rsquo;s first login
                </b>
                , and can&rsquo;t be changed later. Wallets that have already
                signed up won&rsquo;t pick up a new referral.
              </>,
              <>
                파트너에게 받은 <code className="num">…/ref/코드</code> 링크로
                들어오면 &lsquo;✓ 추천 코드가 저장되었습니다.&rsquo;가 표시됩니다.
                추천 관계는{" "}
                <b className="text-text">그 지갑의 첫 로그인 때 한 번만</b> 고정되고
                나중에 바꿀 수 없습니다. 이미 가입한 지갑에는 새로 등록되지
                않습니다.
              </>,
            )}
          </p>
        </Card>
        <Steps
          items={[
            t(
              <>
                Go to{" "}
                <Link href="/" className="underline">
                  www.cryptotradercommunity.org
                </Link>
                . (On a phone: MetaMask app → browser icon at the bottom → enter
                the address.)
              </>,
              <>
                <Link href="/" className="underline">
                  www.cryptotradercommunity.org
                </Link>
                에 접속합니다. (휴대폰: MetaMask 앱 → 하단 브라우저 아이콘 → 주소
                입력)
              </>,
            ),
            t(
              <>
                Click <B>Connect MetaMask</B> at the top right. When the dialog
                opens, click <B>Log in with MetaMask</B>.
              </>,
              <>
                오른쪽 위 <B>MetaMask 연결</B> 버튼을 누릅니다. 안내 창이 열리면{" "}
                <B>MetaMask로 로그인</B>을 누릅니다.
              </>,
            ),
            t(
              <>
                In the MetaMask window, pick the account you want to use and
                approve &lsquo;Connect&rsquo;.
              </>,
              <>
                MetaMask 창에서 사용할 계정을 고르고 &lsquo;연결&rsquo;을
                승인합니다.
              </>,
            ),
            t(
              <>
                If MetaMask asks to switch networks, approve it. The site uses
                the <B>{chain.name}</B> network (chain ID {chain.id}); if
                MetaMask doesn&rsquo;t have it yet, an &lsquo;Add network&rsquo;
                request appears first. This network is only used to verify your
                signature, and switching to it doesn&rsquo;t move any funds.
              </>,
              <>
                네트워크 전환 요청이 오면 승인합니다. 사이트는 <B>{chain.name}</B>
                (체인 ID {chain.id}) 네트워크를 사용하며, MetaMask에 없으면
                &lsquo;네트워크 추가&rsquo; 요청이 먼저 뜹니다. 이 네트워크는 서명
                확인용이며 전환해도 자산이 이동하지 않습니다.
              </>,
            ),
            t(
              <>
                When you see &lsquo;Please sign the login message in
                MetaMask…&rsquo;, click <B>Sign</B> in MetaMask. This signature
                doesn&rsquo;t grant trading permission or approve any fees, and
                it costs no gas.
              </>,
              <>
                &lsquo;MetaMask에서 로그인 메시지에 서명해 주세요…&rsquo;가 보이면
                MetaMask의 <B>서명</B>을 누릅니다. 이 서명은 거래 권한이나 수수료
                승인을 주지 않고 가스비도 들지 않습니다.
              </>,
            ),
            t(
              <>
                Once your wallet address (e.g. 0x12…ab34) appears at the top
                right, you&rsquo;re signed up. Click the address to open{" "}
                <B>My page</B>.
              </>,
              <>
                오른쪽 위에 내 지갑 주소(예: 0x12…ab34)가 보이면 가입 완료입니다.
                주소를 누르면 <B>마이페이지</B>로 이동합니다.
              </>,
            ),
          ]}
        />
        <Notice tone="info">
          {t(
            <>
              For your security, switching accounts or disconnecting in MetaMask
              signs you out automatically. Click <B>Connect MetaMask</B> again
              and sign with the new account.
            </>,
            <>
              MetaMask에서 계정을 바꾸거나 연결을 끊으면 보안을 위해 자동
              로그아웃됩니다. 새 계정으로 다시 <B>MetaMask 연결</B>을 눌러
              서명하세요.
            </>,
          )}
        </Notice>
      </Section>

      <Section
        id="register"
        title={t("2. Register a bot (5 steps)", "2. 봇 등록하기 (5단계)")}
      >
        <p className="text-muted">
          {t(
            <>
              After logging in, go to <B>Bots</B> → <B>Register bot</B>, or{" "}
              <B>My page</B> → <B>Register bot</B> next to &lsquo;Bots I
              registered&rsquo;. The bot owner wallet is filled in automatically
              with the address you&rsquo;re logged in with, and it&rsquo;s shown
              publicly on the bot page. You can jump between steps freely with
              the step buttons (1–5) at the top; the server checks everything
              when you save on the last step.
            </>,
            <>
              로그인 후 <B>봇 마켓</B> → <B>봇 등록</B>, 또는 <B>마이페이지</B> →
              &lsquo;내가 등록한 봇&rsquo; 옆 <B>봇 등록</B>을 누릅니다. 등록자
              지갑은 로그인한 주소로 자동 입력되며 봇 페이지에 공개됩니다. 위쪽의
              단계 버튼(1~5)을 눌러 자유롭게 오갈 수 있고, 입력값은 마지막 단계에서
              저장할 때 서버가 검사합니다.
            </>,
          )}
        </p>

        <StepCard t={t} n={1} title={t("Basics", "기본 정보")}>
          <FieldTable
            t={t}
            rows={[
              [
                t("Bot name", "봇 이름"),
                t("2–60 characters", "2~60자"),
                t("e.g. BTC trend following, 1h candles", "예: BTC 추세추종 1시간봉"),
              ],
              [
                t("Unique slug", "고유 slug"),
                t(
                  "3–48 lowercase letters, digits and hyphens. Can't be changed after creation",
                  "영문 소문자·숫자·하이픈 3~48자. 생성 후 변경 불가",
                ),
                t(
                  "Becomes the bot's address: /bots/btc-trend-1h",
                  "봇 주소가 됩니다: /bots/btc-trend-1h",
                ),
              ],
              [
                t("Logo image URL", "로고 이미지 URL"),
                t("Optional. https addresses only", "선택. https 주소만"),
                t("Fine to leave empty", "비워 두어도 됩니다"),
              ],
              [
                t("One-line summary", "한 줄 소개"),
                t("10–140 characters", "10~140자"),
                t(
                  "The sentence shown on the bot's market card",
                  "마켓 목록 카드에 보이는 문장",
                ),
              ],
              [
                t("Detailed strategy description", "자세한 전략 설명"),
                t("At least 30 characters (max 8,000)", "30자 이상(최대 8,000자)"),
                t(
                  "Describe entry/exit conditions, how stops work, and which markets suit it (and which don't) for a faster review",
                  "진입·청산 조건, 손절 방식, 잘 맞는/안 맞는 장세를 적으면 심사가 빨라집니다",
                ),
              ],
            ]}
          />
        </StepCard>

        <StepCard
          t={t}
          n={2}
          title={t("Strategy & source code", "전략 · 소스코드")}
        >
          <FieldTable
            t={t}
            rows={[
              [
                t("Strategy type", "전략 유형"),
                t("Pick one of the 6 types below", "아래 6가지 중 선택"),
                t(
                  "Martingale and Arbitrage get a risk warning",
                  "Martingale·Arbitrage는 위험 경고가 붙습니다",
                ),
              ],
              [
                t("Strategy source code attachment", "전략 소스코드 첨부"),
                t("Optional. Up to 200KB", "선택. 최대 200KB"),
                t(
                  "See ‘Attaching source code’ below",
                  "아래 ‘소스코드 첨부’ 참고",
                ),
              ],
              [
                t("Markets", "거래 마켓"),
                t(
                  "Hyperliquid perps, up to 10",
                  "Hyperliquid 무기한 선물, 최대 10개",
                ),
                t(
                  "Comma-separated, like BTC-PERP, ETH-PERP. Autocompletes as you type",
                  "BTC-PERP, ETH-PERP처럼 쉼표로 구분. 입력 시 자동완성",
                ),
              ],
              [
                t("Direction", "방향"),
                t("Long/short · Long only · Short only", "롱/숏 · 롱만 · 숏만"),
                "",
              ],
              [
                t("Min / max leverage", "최소 · 최대 레버리지"),
                t("1–50x, min ≤ max", "1~50배, 최소 ≤ 최대"),
                t("1–3x recommended for beginners", "초보자는 1~3배 권장"),
              ],
              [
                t("Timeframe", "타임프레임"),
                "1m · 5m · 15m · 1h · 4h · 1d",
                t(
                  "The candle interval your strategy reads",
                  "전략이 보는 캔들 간격",
                ),
              ],
              [
                t("Order types", "주문 유형"),
                t("Check at least one", "1개 이상 체크"),
                t(
                  "MARKET · LIMIT · STOP_MARKET (stop loss) · TAKE_PROFIT",
                  "MARKET(시장가) · LIMIT(지정가) · STOP_MARKET(손절) · TAKE_PROFIT(익절)",
                ),
              ],
            ]}
          />
          <ul className="mt-3 space-y-1 text-muted">
            {STRATEGY_TYPES.map((s) => (
              <li key={s}>
                <b className="text-text">{L(STRATEGY_LABELS[s])}</b> —{" "}
                {t(STRATEGY_HELP[s].en, STRATEGY_HELP[s].ko)}
              </li>
            ))}
          </ul>
          <details className="mt-3 rounded-lg border border-line p-3">
            <summary className="cursor-pointer font-medium">
              {t(
                "Attaching source code (TradingView Pine Script and more)",
                "소스코드 첨부 방법 (TradingView Pine Script 등)",
              )}
            </summary>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-muted">
              <li>
                {t(
                  <>
                    Click <B>+ Attach source code</B>.
                  </>,
                  <>
                    <B>+ 소스코드 첨부</B>를 누릅니다.
                  </>,
                )}
              </li>
              <li>
                {t(
                  "Choose the language (Pine Script · Python · JavaScript · TypeScript · Other), then paste your code or load a file (.pine .txt .py .js .ts).",
                  "언어(Pine Script · Python · JavaScript · TypeScript · 기타)를 고르고, 코드를 붙여넣거나 파일(.pine .txt .py .js .ts)을 불러옵니다.",
                )}
              </li>
              <li>
                {t(
                  "For Pine Script, the version, indicator/strategy type, number of inputs and number of alerts are detected automatically.",
                  "Pine Script면 버전·indicator/strategy·입력 수·알림 수가 자동으로 표시됩니다.",
                )}
              </li>
              <li>
                {t(
                  <>
                    Choose who can see it.{" "}
                    <b className="text-text">Private (default, recommended)</b>{" "}
                    means only you and the reviewing admins;{" "}
                    <b className="text-text">Public</b> means anyone can view it
                    on the bot page.
                  </>,
                  <>
                    공개 범위를 고릅니다.{" "}
                    <b className="text-text">비공개(기본·권장)</b>는 본인과 심사
                    관리자만, <b className="text-text">공개</b>는 누구나 봇
                    페이지에서 볼 수 있습니다.
                  </>,
                )}
              </li>
            </ol>
            <p className="mt-2 text-muted">
              {t(
                <>
                  Saving is refused if the code contains anything that looks
                  like a private key, seed phrase or API key. The platform never
                  runs attached code; it&rsquo;s there for review and
                  transparency. A Pine <code>indicator()</code> only produces
                  signals and never places orders, so connecting it to automated
                  trading requires a TradingView alert → platform webhook (Phase
                  2).
                </>,
                <>
                  개인키·시드·API 키처럼 보이는 내용이 있으면 저장이 거부됩니다.
                  플랫폼은 첨부한 코드를 실행하지 않습니다(심사·투명성 목적). Pine{" "}
                  <code>indicator()</code>는 신호만 만들고 주문하지 않으므로,
                  자동매매 연결은 TradingView 알림 → 플랫폼 Webhook(Phase 2)이
                  필요합니다.
                </>,
              )}
            </p>
          </details>
        </StepCard>

        <StepCard t={t} n={3} title={t("Risk limits", "위험 한도")}>
          <FieldTable
            t={t}
            rows={[
              [
                t("Max order size (USDC)", "1회 최대 주문 (USDC)"),
                t("No larger than the max position size", "최대 포지션 규모 이하"),
                t("e.g. 200", "예: 200"),
              ],
              [
                t("Max position size (USDC)", "최대 포지션 규모 (USDC)"),
                t(
                  "The total size the bot can hold at once",
                  "한 번에 보유할 수 있는 총 규모",
                ),
                t("e.g. 1,000", "예: 1,000"),
              ],
              [
                t("Max leverage", "최대 레버리지"),
                t(
                  "Within the leverage range from step 2",
                  "2단계의 레버리지 범위 안",
                ),
                t(
                  "Warning above 25x · above 40x the risk level is ‘Extreme’",
                  "25배 초과 시 경고 · 40배 초과는 위험도 ‘극단’",
                ),
              ],
              [
                t("Stop loss (%) — required", "손절 (%) — 필수"),
                t("Greater than 0 and at most 50%", "0보다 크고 50% 이하"),
                t("Above 50% can't be registered", "50% 초과면 등록 불가"),
              ],
              [
                t("Daily loss limit (USDC)", "일일 손실 한도 (USDC)"),
                t(
                  "The bot stops once the day's losses reach this amount",
                  "하루 손실이 이 금액에 닿으면 멈춤",
                ),
                t(
                  "Warning if it's larger than the max position",
                  "최대 포지션보다 크면 경고",
                ),
              ],
              [
                t("Emergency stop (kill switch)", "긴급 중단(kill switch)"),
                t("Must be checked", "반드시 체크"),
                t("You can't save with it unchecked", "체크 해제 시 저장 불가"),
              ],
            ]}
          />
          <p className="mt-2 text-muted">
            {t(
              "The platform's server-side order gate enforces these limits on every bot order. They exist to protect subscribers, so set them accurately to match your strategy rather than padding them generously.",
              "이 한도는 플랫폼 서버의 주문 게이트가 모든 봇 주문에 강제합니다. 구독자 보호 장치이므로 실제 전략보다 넉넉하게 잡기보다 정확하게 적는 것이 좋습니다.",
            )}
          </p>
        </StepCard>

        <StepCard
          t={t}
          n={4}
          title={t("Execution & developer", "실행 · 개발자")}
        >
          <FieldTable
            t={t}
            rows={[
              [
                t("Execution mode", "실행 방식"),
                t(
                  "Platform strategy template · Verified strategy package · External signal webhook",
                  "플랫폼 전략 템플릿 · 검증된 전략 패키지 · 외부 신호 Webhook",
                ),
                t(
                  "Packages and webhooks get a security review warning and are enabled in Phase 2",
                  "패키지·Webhook은 보안 심사 경고가 붙으며 Phase 2에 활성화",
                ),
              ],
              [
                t("Developer bio", "개발자 소개"),
                t("Optional, up to 1,000 characters", "선택, 1,000자 이내"),
                t(
                  "Your experience, operating principles and so on",
                  "경력·운영 원칙 등",
                ),
              ],
              [
                t("Blog · X · Telegram", "블로그 · X · Telegram"),
                t("Optional, https addresses only", "선택, https 주소만"),
                t(
                  "Channels where subscribers can reach you and check your work",
                  "구독자가 연락·검증할 수 있는 채널",
                ),
              ],
            ]}
          />
        </StepCard>

        <StepCard t={t} n={5} title={t("Fees & consent", "수수료 · 동의")}>
          <p className="text-muted">
            {t(
              <>
                Use the slider to set your{" "}
                <b className="text-text">additional Builder Fee rate</b>, from
                0% up to the platform cap of{" "}
                <b className="text-text">{feeLabel(cap)}</b>, in 0.001% steps.
                Right below the slider you&rsquo;ll see the result calculated
                instantly as &lsquo;○ USDC per 10,000 USDC filled&rsquo;. For
                details, see{" "}
                <a href="#fee" className="underline">
                  3. Fee settings
                </a>
                .
              </>,
              <>
                슬라이더로 <b className="text-text">추가 Builder Fee율</b>을 0%부터
                플랫폼 상한 <b className="text-text">{feeLabel(cap)}</b>까지 0.001%
                단위로 정합니다. 슬라이더 아래에 &lsquo;체결 금액 10,000 USDC당 ○
                USDC&rsquo;가 바로 계산되어 보입니다. 자세한 내용은{" "}
                <a href="#fee" className="underline">
                  3. 수수료 설정
                </a>
                을 보세요.
              </>,
            )}
          </p>
          <p className="mt-2 text-muted">
            {t(
              "Tick all three consents (terms of use · risk disclosure · performance display policy), then choose a button.",
              "세 가지 동의(이용약관 · 위험 고지 · 수익률 표시 정책)에 모두 체크한 뒤 버튼을 고릅니다.",
            )}
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted">
            <li>
              {t(
                <>
                  <B>Save draft</B> — saves a draft (DRAFT) only you can see.
                  You can edit it and submit it for review later.
                </>,
                <>
                  <B>초안 저장</B> — 나만 볼 수 있는 초안(DRAFT)으로 저장. 나중에
                  수정 후 심사 요청 가능.
                </>,
              )}
            </li>
            <li>
              {t(
                <>
                  <B>Save &amp; submit for review</B> — saves and sends the bot
                  straight to admin review (SUBMITTED).
                </>,
                <>
                  <B>저장 후 심사 요청</B> — 저장과 동시에 관리자 심사(SUBMITTED)로
                  보냅니다.
                </>,
              )}
            </li>
          </ul>
          <p className="mt-2 text-muted">
            {t(
              <>
                If something&rsquo;s wrong, a red box lists the field and the
                reason (e.g. <code>slug</code>: 3–48 lowercase letters, digits
                and hyphens). Go back to that step, fix it and save again.
              </>,
              <>
                입력에 문제가 있으면 빨간 상자에 항목과 이유가 표시됩니다(예:{" "}
                <code>slug</code>: 영문 소문자, 숫자, 하이픈 3~48자). 해당 단계로
                돌아가 고친 뒤 다시 저장하세요.
              </>,
            )}
          </p>
        </StepCard>
      </Section>

      <Section
        id="fee"
        title={t(
          "3. Fee (commission) settings in detail",
          "3. 수수료(커미션) 설정 자세히",
        )}
      >
        <Card className="space-y-2">
          <p className="font-semibold">
            {t(
              "Subscribers pay two kinds of fees",
              "구독자가 내는 수수료는 두 가지입니다",
            )}
          </p>
          <p className="text-muted">
            {t(
              <>
                <b className="text-text">① Hyperliquid base trading fee</b> —
                kept by the exchange (base tier: taker 0.045% / maker 0.015%).
                It is not income for bot owners or the platform.
              </>,
              <>
                <b className="text-text">① Hyperliquid 기본 거래 수수료</b> —
                거래소가 가져갑니다(기본 등급 taker 0.045% / maker 0.015%). 봇
                등록자·플랫폼 수익이 아닙니다.
              </>,
            )}
          </p>
          <p className="text-muted">
            {t(
              <>
                <b className="text-text">② Additional Builder Fee</b> — the rate
                you set with the slider in step 5 (Fees &amp; consent) of bot
                registration. Every time an order placed by your bot is filled,{" "}
                <b className="text-text">filled amount × fee rate</b> is added
                on top. This is the only source of income for bot owners,
                partners and the platform, and only one is charged per order.
              </>,
              <>
                <b className="text-text">② 추가 Builder Fee</b> — 여러분이 봇 등록
                5단계(수수료 · 동의) 슬라이더로 정하는 값입니다. 봇이 낸 주문이
                체결될 때마다 <b className="text-text">체결 금액 × 수수료율</b>만큼
                붙고, 이것이 봇 등록자·파트너·플랫폼 수익의 유일한 원천입니다. 한
                주문에 하나만 붙습니다.
              </>,
            )}
          </p>
        </Card>

        <h3 className="font-semibold">
          {t(
            "Examples by fee rate (per 10,000 USDC filled)",
            "수수료율별 예시 (체결 금액 10,000 USDC 기준)",
          )}
        </h3>
        <div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-faint">
              <tr>
                <th className="py-2">{t("Fee rate", "설정 수수료율")}</th>
                <th className="py-2 text-right">Builder Fee</th>
                <th className="py-2 text-right">
                  {t("Bot owner's share (70%)", "봇 등록자 몫 (70%)")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {exampleRates.map((r) => (
                <tr key={r}>
                  <td className="num py-2">
                    {feeLabel(r)}
                    {r === cap && (
                      <span className="block font-sans text-xs text-faint">
                        {t("Current cap", "현재 상한")}
                      </span>
                    )}
                  </td>
                  <td className="num py-2 text-right">
                    {usdc(feeOn(10_000, r))}
                  </td>
                  <td className="num py-2 text-right text-accent">
                    {usdc(feeOn(10_000, r).mul(0.7))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="font-semibold">
          {t(
            <>
              Split example — subscribers fill {monthly.toLocaleString("en-US")}{" "}
              USDC in a month at a {feeLabel(exRate)} fee rate
            </>,
            <>
              배분 예시 — 한 달 구독자 체결 합계 {monthly.toLocaleString("en-US")}{" "}
              USDC, 수수료율 {feeLabel(exRate)}
            </>,
          )}
        </h3>
        <p className="text-muted">
          {t(
            <>
              Total Builder Fee = {monthly.toLocaleString("en-US")} ×{" "}
              {feeLabel(exRate)} = <b className="text-text">{usdc(exFee)}</b>{" "}
              (once confirmed)
            </>,
            <>
              Builder Fee 합계 = {monthly.toLocaleString("en-US")} ×{" "}
              {feeLabel(exRate)} = <b className="text-text">{usdc(exFee)}</b> (정산
              확정 기준)
            </>,
          )}
        </p>
        <div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {(
                [
                  ["Bot owner (you)", "봇 등록자 (나)", "70%", 0.7],
                  ["Platform net revenue", "플랫폼 최종 수익", "6%", 0.06],
                  ["Tier-1 referral partner", "1차 추천 파트너", "14.4%", 0.144],
                  ["Tier-2 referral partner", "2차 추천 파트너", "9.6%", 0.096],
                ] as const
              ).map(([en, ko, pct, share]) => (
                <tr key={pct}>
                  <td className="py-2">{t(en, ko)}</td>
                  <td className="num py-2 text-right text-muted">{pct}</td>
                  <td className="num py-2 text-right font-semibold">
                    {usdc(exFee.mul(share))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-faint">
          {t(
            "These split ratios are the initial default policy. If a subscriber has no referrer, the partner shares are held as an unassigned reserve, and the bot owner's 70% stays the same. Policy changes never apply retroactively to past settlements.",
            "배분 비율은 초기 기본 정책입니다. 구독자에게 추천인이 없으면 파트너 몫은 미배정 예비금으로 보류되며 봇 등록자 몫(70%)은 그대로입니다. 정책이 바뀌어도 과거 정산에는 소급되지 않습니다.",
          )}
        </p>

        <Card className="space-y-2">
          <p className="font-semibold">
            {t("Tips for choosing a fee rate", "수수료율을 정하는 요령")}
          </p>
          <ul className="list-inside list-disc space-y-1 text-muted">
            <li>
              {t(
                "Subscribers pay your fee on top of the exchange fee (up to 0.045%). The more often a strategy trades (1m/5m, grid), the more a low fee helps subscribers' returns.",
                "구독자는 거래소 수수료(최대 0.045%)에 여러분의 수수료를 더해 냅니다. 매매가 잦은 전략(1m·5m, 그리드)일수록 낮은 수수료가 구독자 수익에 유리합니다.",
              )}
            </li>
            <li>
              {t(
                "Strategies that trade rarely but aim for a bigger gain per trade (4h/1d trend following) can usually justify a somewhat higher fee.",
                "매매 빈도가 낮고 한 번의 기대 수익이 큰 전략(4h·1d 추세추종)은 상대적으로 높은 수수료도 받아들여지기 쉽습니다.",
              )}
            </li>
            <li>
              {t(
                "We recommend starting low and raising the fee once your live performance is verified (raising it requires subscriber re-consent).",
                "처음에는 낮게 시작해 실거래 성과가 검증된 뒤 올리는 방법을 권장합니다(올릴 때는 재동의가 필요합니다).",
              )}
            </li>
          </ul>
        </Card>

        <Card className="space-y-2">
          <p className="font-semibold">
            {t(
              "Changing your fee after registration",
              "등록 후 수수료를 바꾸면",
            )}
          </p>
          <ul className="list-inside list-disc space-y-1 text-muted">
            <li>
              {t(
                <>
                  Bot page → <B>Edit</B> → change it in step 5 →{" "}
                  <B>Save changes</B>. Changing only the fee does not trigger
                  another review.
                </>,
                <>
                  봇 페이지 → <B>수정</B> → 5단계에서 변경 → <B>변경 저장</B>.
                  수수료만 바꾸는 것은 재심사 대상이 아닙니다.
                </>,
              )}
            </li>
            <li>
              {t(
                <>
                  <b className="text-text">Lowering</b>: applies to existing
                  subscribers immediately.
                </>,
                <>
                  <b className="text-text">인하</b>: 기존 구독자에게 즉시
                  적용됩니다.
                </>,
              )}
            </li>
            <li>
              {t(
                <>
                  <b className="text-text">Raising</b>: existing subscribers move
                  to &lsquo;Re-consent required&rsquo;, and your bot&rsquo;s
                  orders for each of them are blocked until they re-consent.
                  Subscribers only ever pay the fee they agreed to.
                </>,
                <>
                  <b className="text-text">인상</b>: 기존 구독자는 &lsquo;재동의
                  필요&rsquo; 상태가 되고, 재동의하기 전까지 그 구독자에 대한 봇
                  주문이 차단됩니다. 구독자는 항상 자신이 동의한 수수료만 냅니다.
                </>,
              )}
            </li>
            <li>
              {t(
                <>
                  Subscribers also have to approve a Builder Fee cap by signing
                  with their main wallet on the <B>Trade</B> screen, and the
                  server rejects any order whose fee would exceed that approved
                  cap.
                </>,
                <>
                  구독자 쪽에서도 <B>트레이딩</B> 화면에서 메인 지갑으로 Builder Fee
                  상한을 서명 승인해야 하며, 적용 수수료가 승인 상한을 넘는 주문은
                  서버가 거부합니다.
                </>,
              )}
            </li>
          </ul>
        </Card>
      </Section>

      <Section
        id="review"
        title={t(
          "4. Review, publishing and running your bot",
          "4. 심사 · 마켓 공개 · 운영",
        )}
      >
        <div className="divide-y divide-line">
          {(
            [
              [
                "DRAFT",
                t("DRAFT", "DRAFT 초안"),
                t("Visible only to you", "나만 보임"),
                t("Bot page → Submit for review", "봇 페이지 → 심사 요청"),
              ],
              [
                "SUBMITTED",
                "SUBMITTED · UNDER_REVIEW",
                t(
                  "Admins are checking the settings, risk and source code",
                  "관리자가 설정·위험·소스코드를 검토 중",
                ),
                t("Wait", "기다리기"),
              ],
              [
                "REJECTED",
                t("REJECTED", "REJECTED 반려"),
                t("The rejection reason is recorded", "반려 사유가 기록됨"),
                t("Edit → Submit for review", "수정 → 심사 요청"),
              ],
              [
                "APPROVED",
                t("APPROVED", "APPROVED 승인"),
                t(
                  "Ready to publish (not yet visible in the market)",
                  "공개 준비 완료(아직 마켓에 안 보임)",
                ),
                t("Publish to market (LIVE)", "마켓에 공개 (LIVE)"),
              ],
              [
                "LIVE",
                t("LIVE", "LIVE 운영 중"),
                t(
                  "Listed in the bot market and open to subscriptions",
                  "봇 마켓에 공개, 구독 가능",
                ),
                t(
                  "Pause (blocks new orders) when needed",
                  "필요 시 일시 중지 (신규 주문 차단)",
                ),
              ],
              [
                "PAUSED",
                t("PAUSED", "PAUSED 일시 중지"),
                t(
                  "Shown as ‘Paused’ in the market; no new orders",
                  "마켓에 ‘일시 중지’로 표시, 신규 주문 없음",
                ),
                t(
                  "Resume with Publish to market (LIVE)",
                  "마켓에 공개 (LIVE)로 재개",
                ),
              ],
              [
                "SUSPENDED",
                "SUSPENDED",
                t("Suspended by an admin", "관리자가 운영을 정지"),
                t("Check the admin's notice", "관리자 안내 확인"),
              ],
            ] as const
          ).map(([k, s, m, a]) => (
            <div
              key={k}
              className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr_1fr] sm:gap-3"
            >
              <span className="num font-medium">{s}</span>
              <span className="text-muted">{m}</span>
              <span>→ {a}</span>
            </div>
          ))}
        </div>
        <Notice tone="info">
          {t(
            <>
              If you change a live bot&rsquo;s{" "}
              <b>
                strategy type, markets, direction, leverage, timeframe, order
                types, risk limits, execution mode or source code
              </b>
              , it&rsquo;s taken off the market and goes back to review
              (SUBMITTED). Changes to the name, summary, description, developer
              info or fee apply without another review. Every change is kept in
              the version history.
            </>,
            <>
              운영 중인 봇의{" "}
              <b>
                전략 유형·마켓·방향·레버리지·타임프레임·주문 유형·위험 한도·실행
                방식·소스코드
              </b>
              를 바꾸면 공개가 중단되고 다시 심사(SUBMITTED)를 받습니다.
              이름·소개·설명·개발자 정보·수수료 변경은 재심사 없이 반영됩니다. 모든
              변경은 버전 이력으로 남습니다.
            </>,
          )}
        </Notice>
      </Section>

      <Section
        id="payout"
        title={t("5. Earnings and payouts", "5. 수익 확인과 지급")}
      >
        <Steps
          items={[
            t(
              <>
                When a subscriber&rsquo;s bot order fills on Hyperliquid, the
                Builder Fee is recorded as &lsquo;Observed&rsquo;.
              </>,
              <>
                구독자의 봇 주문이 Hyperliquid에서 체결되면 Builder Fee가
                &lsquo;관측&rsquo; 상태로 기록됩니다.
              </>,
            ),
            t(
              <>
                Admins reconcile it against Hyperliquid&rsquo;s Builder reward
                records and mark it &lsquo;Confirmed&rsquo;; your 70% share is
                then credited to your ledger.
              </>,
              <>
                관리자가 Hyperliquid의 Builder 보상 내역과 대사(맞춰 보기)한 뒤
                &lsquo;정산 확정&rsquo;하면 70% 몫이 내 원장에 쌓입니다.
              </>,
            ),
            t(
              <>
                Check the confirmed amount under <B>My page</B> → &lsquo;Unpaid
                bot earnings&rsquo;.
              </>,
              <>
                <B>마이페이지</B> → &lsquo;봇 수익 미지급 잔액&rsquo;에서 확정된
                금액을 확인합니다.
              </>,
            ),
            t(
              <>
                After admin approval, USDC is paid to the wallet you log in with
                (minimum 1 USDC). Automatic payouts come in Phase 2.
              </>,
              <>
                관리자 승인 후 로그인한 지갑으로 USDC가 지급됩니다(최소 1 USDC).
                자동 지급은 Phase 2입니다.
              </>,
            ),
          ]}
        />
        <p className="text-xs text-faint">
          {t(
            <>
              The platform never shows unconfirmed amounts as earnings.
              Performance and rankings are calculated only from fills of bot
              orders the platform actually placed, and bots with fewer than 20
              closing fills or under 14 days of operation show &lsquo;Not enough
              verified data&rsquo;.
            </>,
            <>
              플랫폼은 확정되지 않은 금액을 수익으로 표시하지 않습니다. 성과·랭킹은
              플랫폼이 실제로 낸 봇 주문의 체결만으로 계산하며, 청산 체결 20건·운영
              14일 미만이면 &lsquo;검증 데이터 부족&rsquo;으로 표시됩니다.
            </>,
          )}
        </p>
      </Section>

      <Section
        id="faq"
        title={t("6. FAQ and troubleshooting", "6. 자주 묻는 질문 · 문제 해결")}
      >
        <Faq
          q={t(
            "I see ‘MetaMask extension not detected’.",
            "‘MetaMask 확장 프로그램이 감지되지 않았습니다’가 나와요.",
          )}
        >
          {t(
            "Install MetaMask and refresh the page. On a phone, open the site inside the MetaMask app's browser, not a regular browser (tapping the connect button takes you to the app).",
            "MetaMask를 설치한 뒤 페이지를 새로고침하세요. 휴대폰이라면 일반 브라우저가 아니라 MetaMask 앱 안의 브라우저에서 열어야 합니다(연결 버튼을 누르면 앱으로 이동합니다).",
          )}
        </Faq>
        <Faq
          q={t(
            "I see ‘MetaMask has a pending request’.",
            "‘MetaMask에 처리 대기 중인 요청이 있습니다’가 나와요.",
          )}
        >
          {t(
            "Click the MetaMask icon at the top right of your browser, approve or reject the open request, then try again.",
            "브라우저 오른쪽 위 MetaMask 아이콘을 눌러 열려 있는 요청을 승인하거나 거절한 뒤 다시 시도하세요.",
          )}
        </Faq>
        <Faq
          q={t(
            "Does signing cost money? Can the platform take my funds?",
            "서명하면 돈이 나가나요? 내 자금을 플랫폼이 가져가나요?",
          )}
        >
          {t(
            "The login signature costs no gas and grants no permissions. Your funds stay in your own Hyperliquid account, and the platform cannot withdraw them.",
            "로그인 서명은 가스비가 없고 어떤 권한도 주지 않습니다. 자금은 본인 Hyperliquid 계정에 그대로 있고 플랫폼은 출금할 수 없습니다.",
          )}
        </Faq>
        <Faq
          q={t(
            "I can't see the bot registration screen.",
            "봇 등록 화면이 안 보여요.",
          )}
        >
          {t(
            <>
              If you&rsquo;re not logged in, you&rsquo;ll see &lsquo;Registering
              a bot requires a wallet signature login&rsquo;. Log in with Connect
              MetaMask at the top right, then open the page again.
            </>,
            <>
              로그인하지 않으면 &lsquo;봇 등록은 지갑 서명 로그인이
              필요합니다&rsquo;가 표시됩니다. 오른쪽 위 MetaMask 연결로 로그인한 뒤
              다시 들어가세요.
            </>,
          )}
        </Faq>
        <Faq
          q={t(
            "I get an error when I click save.",
            "저장 버튼을 눌렀는데 오류가 나요.",
          )}
        >
          {t(
            <>
              The field name in the red box (e.g. risk.maxOrderUsd) tells you
              where the problem is. Common causes: slug format, a one-line
              summary under 10 characters, a description under 30 characters,
              max order size &gt; max position size, risk-limit leverage &gt;
              the max leverage from step 2, unchecked consents, or a slug
              that&rsquo;s already taken.
            </>,
            <>
              빨간 상자의 항목 이름(예: risk.maxOrderUsd)이 문제 위치입니다. 자주
              나오는 원인: slug 형식, 한 줄 소개 10자 미만, 설명 30자 미만, 1회 최대
              주문 &gt; 최대 포지션, 위험 한도 레버리지 &gt; 2단계 최대 레버리지,
              동의 미체크, 이미 사용 중인 slug.
            </>,
          )}
        </Faq>
        <Faq
          q={t(
            "Do I have to upload source code? Can others see my code?",
            "소스코드를 꼭 올려야 하나요? 남이 내 코드를 볼 수 있나요?",
          )}
        >
          {t(
            <>
              It&rsquo;s optional. With the default &lsquo;Private&rsquo;
              setting, only you and the reviewing admins can see it, and the bot
              page shows just a summary such as the language and line count.
            </>,
            <>
              선택입니다. 기본값 &lsquo;비공개&rsquo;면 본인과 심사 관리자만 볼 수
              있고, 봇 페이지에는 언어·줄 수 같은 요약만 표시됩니다.
            </>,
          )}
        </Faq>
        <Faq
          q={t(
            "Can I enter a referral link later?",
            "추천 링크를 나중에 입력할 수 있나요?",
          )}
        >
          {t(
            "No. The referral is locked in only at a wallet's first login. Open the referral link first, then log in for the first time.",
            "아니요. 추천 관계는 지갑의 첫 로그인 때만 고정됩니다. 추천 링크로 먼저 접속한 뒤 처음 로그인하세요.",
          )}
        </Faq>
        <p className="text-muted">
          {t(
            <>
              For the official notices on fees, security and risk, see{" "}
              <Link href="/docs" className="underline">
                Service, fees &amp; security
              </Link>
              ; for how referral earnings work, connect MetaMask and open{" "}
              <Link href="/portfolio#partner" className="underline">
                My page → Partner program
              </Link>
              .
            </>,
            <>
              수수료·보안·위험에 대한 공식 고지는{" "}
              <Link href="/docs" className="underline">
                서비스·수수료·보안 문서
              </Link>
              , 추천 수익 구조는 MetaMask 연결 후{" "}
              <Link href="/portfolio#partner" className="underline">
                마이페이지 → 파트너 프로그램
              </Link>
              에서 확인하세요.
            </>,
          )}
        </p>
      </Section>
    </article>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** On-screen button or label name. */
function B({ children }: { children: ReactNode }) {
  return (
    <b className="rounded bg-panel-2 px-1.5 py-0.5 font-semibold text-text">
      {children}
    </b>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">
            {i + 1}
          </span>
          <span className="text-muted">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function StepCard({
  t,
  n,
  title,
  children,
}: {
  t: I18n["t"];
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <h3 className="mb-3 font-semibold">
        <span className="text-accent">{t(`Step ${n}`, `${n}단계`)}</span> ·{" "}
        {title}
      </h3>
      {children}
    </Card>
  );
}

function FieldTable({
  t,
  rows,
}: {
  t: I18n["t"];
  rows: [string, string, string][];
}) {
  return (
    <div className="divide-y divide-line">
      <div className="hidden gap-3 pb-1.5 text-xs text-faint sm:grid sm:grid-cols-[10rem_1fr_1fr]">
        <span>{t("Field", "항목")}</span>
        <span>{t("Rules", "규칙")}</span>
        <span>{t("Example · tip", "예시 · 팁")}</span>
      </div>
      {rows.map(([field, rule, tip]) => (
        <div
          key={field}
          className="grid gap-0.5 py-2 sm:grid-cols-[10rem_1fr_1fr] sm:gap-3"
        >
          <span className="font-medium">{field}</span>
          <span className="text-muted">{rule}</span>
          {tip && <span className="text-faint">{tip}</span>}
        </div>
      ))}
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer font-medium">{q}</summary>
      <p className="mt-2 text-muted">{children}</p>
    </details>
  );
}
