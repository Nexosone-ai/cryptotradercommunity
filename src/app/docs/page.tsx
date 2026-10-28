import type { Metadata } from "next";
import Link from "next/link";
import { Card, Notice } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { feeLabel } from "@/lib/format";
import { getI18n } from "@/lib/i18n-server";
import { SWAP_FEE_NOTICE, SWAP_RESPONSIBILITY_NOTICE } from "@/lib/swap/notices";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Service, fees & security", "서비스·수수료·보안 문서") };
}

export default async function DocsPage() {
  const { t, L } = await getI18n();
  const cfg = getConfig();
  return (
    <article className="mx-auto max-w-3xl space-y-8 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">{t("Service, fees & security", "서비스 · 수수료 · 보안 안내")}</h1>
      <Notice tone="info">
        {t(
          <>
            New here? Start with the{" "}
            <Link href="/guide" className="underline">
              User guide
            </Link>
            , which walks you step by step from sign-up to registering a bot and setting fees.
          </>,
          <>
            처음이신가요? 가입부터 봇 등록·수수료 설정까지 단계별로 설명한{" "}
            <Link href="/guide" className="underline">
              이용 가이드
            </Link>
            를 먼저 보세요.
          </>,
        )}
      </Notice>

      <section id="service" className="space-y-2">
        <h2 className="text-lg font-semibold">{t("How the service works", "서비스 구조")}</h2>
        <p className="text-muted">
          {t(
            "CryptoTraderCommunity is a non-custodial trading bot marketplace that uses Hyperliquid perpetual futures (perps) liquidity. We don't run our own order book or liquidity; every order is filled on Hyperliquid. Your funds stay in your own Hyperliquid account, and the platform can neither hold nor withdraw them.",
            "CryptoTraderCommunity는 Hyperliquid 무기한 선물(Perpetuals) 유동성을 사용하는 비수탁형 트레이딩 봇 마켓플레이스입니다. 자체 오더북이나 유동성을 운영하지 않으며, 모든 주문은 Hyperliquid에서 체결됩니다. 사용자 자금은 본인 Hyperliquid 계정에 남아 있고 플랫폼은 자금을 보관하거나 출금할 수 없습니다.",
          )}
        </p>
        <p className="text-muted">
          {t("Current network: ", "현재 네트워크: ")}
          <b className="text-text">
            {cfg.network === "mainnet" ? "Mainnet" : t("Testnet (not real funds)", "Testnet (실제 자금 아님)")}
          </b>
        </p>
      </section>

      <section id="fees" className="space-y-3">
        <h2 className="text-lg font-semibold">{t("Fees", "수수료")}</h2>
        <Card className="space-y-2 text-muted">
          <p>
            {t(
              <>
                <b className="text-text">① Hyperliquid base trading fee</b> — collected by Hyperliquid (base tier: taker 0.045% / maker 0.015%; varies with volume,
                staking and referral discounts). The platform neither receives nor distributes this fee.
              </>,
              <>
                <b className="text-text">① Hyperliquid 기본 거래 수수료</b> — Hyperliquid가 징수합니다(기본 등급 taker 0.045% / maker 0.015%, 거래량·스테이킹·추천 할인에 따라
                변동). 플랫폼은 이 수수료를 받거나 분배하지 않습니다.
              </>,
            )}
          </p>
          <p>
            {t(
              <>
                <b className="text-text">② Additional Builder Fee</b> — a fee added to each order through Hyperliquid&rsquo;s official Builder Codes. It can never exceed the cap
                you approved with a main wallet signature (Hyperliquid&rsquo;s cap for perps is 0.1%), and the platform cap is {feeLabel(cfg.platformMaxFeeTenthsBp)}. Only one
                Builder Fee is attached per order, so you are never charged a platform fee and a bot fee twice.
              </>,
              <>
                <b className="text-text">② 추가 Builder Fee</b> — Hyperliquid 공식 Builder Codes로 주문마다 추가되는 수수료입니다. 사용자가 메인 지갑 서명으로 승인한 상한을
                넘을 수 없고(Hyperliquid 상한 perps 0.1%), 플랫폼 상한은 {feeLabel(cfg.platformMaxFeeTenthsBp)}입니다. 한 주문에는 하나의 Builder Fee만 붙으며 플랫폼 수수료와
                봇 수수료를 이중 청구하지 않습니다.
              </>,
            )}
          </p>
          <p>
            {t(
              <>
                <b className="text-text">③ Split</b> — 100% of the Builder Fee actually received and confirmed is split 70% to the bot owner and 30% to the admin-managed
                distribution pool (platform 6% · tier-1 partner 14.4% · tier-2 partner 9.6%). If there is no referrer, the partner shares are held as an unassigned reserve.
                Policy changes are recorded as versions and never apply retroactively to past settlements.
              </>,
              <>
                <b className="text-text">③ 배분</b> — 실제 수취·정산 확정된 Builder Fee 100%를 기준으로 봇 등록자 70%, 관리자 배분 풀 30%(플랫폼 6% · 1차 파트너 14.4% · 2차
                파트너 9.6%)로 나눕니다. 추천인이 없으면 파트너 몫은 미배정 예비금으로 보류됩니다. 정책 변경은 버전으로 기록되며 과거 정산에 소급하지 않습니다.
              </>,
            )}
          </p>
          <p>
            {t(
              <>
                <b className="text-text">④ Payout</b> — Hyperliquid does not automatically send money to multiple wallets when an order fills. Builder rewards accrue to the
                platform&rsquo;s Builder address and are paid out after the claim is confirmed and an admin approves the payout.
              </>,
              <>
                <b className="text-text">④ 지급</b> — Hyperliquid는 체결 즉시 여러 지갑으로 자동 송금하지 않습니다. Builder 보상은 플랫폼 Builder 주소에 적립되고, 청구(claim)
                확인 후 관리자 승인을 거쳐 지급합니다.
              </>,
            )}
          </p>
        </Card>
      </section>

      <section id="security" className="space-y-2">
        <h2 className="text-lg font-semibold">{t("Security", "보안")}</h2>
        <ul className="list-inside list-disc space-y-1 text-muted">
          <li>
            {t(
              "Login uses MetaMask signatures (EIP-4361, SIWE) only. Each sign-in nonce is single-use and expires after 10 minutes.",
              "로그인은 MetaMask 서명(EIP-4361)만 사용합니다. 서명용 nonce는 1회용이며 10분 후 만료됩니다.",
            )}
          </li>
          <li>
            {t(
              "We will never ask for your Secret Recovery Phrase or private key. Any screen that asks for them is phishing.",
              "비밀복구구문·개인키를 절대 요청하지 않습니다. 이를 요구하는 화면은 피싱입니다.",
            )}
          </li>
          <li>
            {t(
              "Login and trading permission are separate. Approving the Builder Fee and approving trading permission (agent wallet) each require their own signature.",
              "로그인과 거래 권한은 분리되어 있습니다. Builder Fee 승인과 거래 권한(Agent Wallet) 승인은 각각 별도 서명이 필요합니다.",
            )}
          </li>
          <li>
            {t(
              "The agent wallet can only sign orders and cannot withdraw funds. Limits on what and how much can be ordered are enforced by the platform server's order gate, not by the Hyperliquid protocol.",
              "Agent Wallet은 주문 서명만 가능하며 출금할 수 없습니다. 주문 범위·금액 제한은 Hyperliquid 프로토콜이 아니라 플랫폼 서버의 주문 게이트가 강제합니다.",
            )}
          </li>
          <li>
            {t(
              "Admin and partner screens and APIs check roles on the server. Settlement and admin actions are recorded in a tamper-evident, hash-chained audit log.",
              "관리자·파트너 화면과 API는 서버에서 역할을 검사합니다. 정산·관리 작업은 변경 불가능한 해시 체인 감사 로그에 기록됩니다.",
            )}
          </li>
        </ul>
      </section>

      <section id="performance" className="space-y-2">
        <h2 className="text-lg font-semibold">{t("Performance display policy", "성과 표시 정책")}</h2>
        <ul className="list-inside list-disc space-y-1 text-muted">
          <li>
            {t(
              "Bot performance counts only Hyperliquid fills of orders the platform sent for that bot (mapped by cloid). We never present a wallet's overall returns as a bot's track record.",
              "봇 성과는 플랫폼이 해당 봇 실행으로 전송한 주문(cloid 매핑)의 Hyperliquid 체결만 집계합니다. 지갑 전체 수익률을 봇 실적으로 표시하지 않습니다.",
            )}
          </li>
          <li>
            {t(
              <>
                With fewer than 20 closing fills or under 14 days of operation, a bot shows &lsquo;Not enough verified data&rsquo; and gets no return figure or ranking.
              </>,
              <>
                청산 체결 20건·운영 14일 미만이면 &lsquo;검증 데이터 부족&rsquo;으로 표시하고 수익률·순위를 만들지 않습니다.
              </>,
            )}
          </li>
          <li>
            {t(
              "Backtests and self-reported results are never mixed with live-trading metrics or rankings.",
              "백테스트·자가 보고 실적은 실거래 지표·랭킹과 섞지 않습니다.",
            )}
          </li>
        </ul>
      </section>

      <section id="swap" className="space-y-2">
        <h2 className="text-lg font-semibold">{t("P2P swap", "P2P 스왑")}</h2>
        <Notice>
          {L(SWAP_FEE_NOTICE)} {L(SWAP_RESPONSIBILITY_NOTICE)}
        </Notice>
        <p className="text-muted">
          {t(
            "A swap is a peer-to-peer (P2P) trade: the seller signs an order at a fixed price, and the buyer fills it directly through a smart contract. The platform never holds tokens or acts as a counterparty, and each user is responsible for checking the price, token and counterparty, and for the outcome. Users pay the network gas fees.",
            "스왑은 판매자가 정한 고정 가격의 서명 주문을 구매자가 스마트 컨트랙트로 직접 체결하는 이용자 간(P2P) 거래입니다. 플랫폼은 토큰을 보관하거나 거래 상대방이 되지 않으며, 가격·토큰·상대방의 확인과 그 결과는 각 이용자의 책임입니다. 네트워크 가스비는 이용자가 지불합니다.",
          )}
        </p>
      </section>

      <section id="risk" className="space-y-2">
        <h2 className="text-lg font-semibold">{t("Risk disclosure", "위험 고지")}</h2>
        <Notice tone="down">
          {t(
            "Leveraged futures trading carries the risk of losing your entire principal and of forced liquidation. Automated trading can behave unexpectedly due to outages, latency or sharp market moves. Past performance does not guarantee future returns, and the platform guarantees no profit of any kind. You are responsible for checking that using this service is permitted in your jurisdiction.",
            "레버리지 선물 거래는 원금 전액 손실 및 강제청산 위험이 있습니다. 자동매매는 장애·지연·급변동으로 예상과 다르게 동작할 수 있습니다. 과거 성과는 미래 수익을 보장하지 않으며 플랫폼은 어떠한 수익도 보장하지 않습니다. 본인의 관할 지역에서 서비스 이용이 허용되는지 확인할 책임은 이용자에게 있습니다.",
          )}
        </Notice>
      </section>

      <section id="terms" className="space-y-2">
        <h2 className="text-lg font-semibold">{t("Terms of use", "이용약관")}</h2>
        <Notice>
          {t(
            "The final terms of use will be published after legal review (docs/LEGAL_CHECKLIST.md). The current text is a notice about the service structure, fees and risks and does not include any assessment of legal compliance.",
            "이용약관 최종본은 법률 검토 후 게시됩니다(docs/LEGAL_CHECKLIST.md). 현재 문구는 서비스 구조·수수료·위험에 대한 고지이며 법적 적합성 판단을 포함하지 않습니다.",
          )}
        </Notice>
      </section>
    </article>
  );
}
