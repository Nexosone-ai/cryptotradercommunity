"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { buttonClass, Notice } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";
import { apiFetch } from "@/lib/client-api";
import { feeLabel } from "@/lib/format";
import { bi } from "@/lib/i18n";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (url: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(url, { method: "POST", body: body ?? {} });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : bi("Request failed", "요청 실패"));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function SubscribePanel({
  botId,
  live,
  feeTenthsBp,
  maxOrderUsd,
  subscription,
}: {
  botId: string;
  live: boolean;
  feeTenthsBp: number;
  maxOrderUsd: number;
  subscription: { status: string; acceptedFeeTenthsBp: number; pendingFeeTenthsBp: number | null } | null;
}) {
  const w = useWallet();
  const { t, L } = useI18n();
  const { busy, error, run } = useAction();
  const [accept, setAccept] = useState(false);
  const [amount, setAmount] = useState(String(Math.min(100, maxOrderUsd)));

  if (!w.me?.user) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted">{t("Sign in with your wallet to subscribe to this bot.", "봇을 구독하려면 지갑으로 로그인하세요.")}</p>
        <button className={buttonClass("primary") + " w-full"} onClick={w.openConnect}>
          {t("Connect MetaMask", "MetaMask 연결")}
        </button>
      </div>
    );
  }

  const active = subscription?.status === "ACTIVE";
  const reconsent = subscription?.status === "REQUIRES_RECONSENT";

  return (
    <div className="space-y-3 text-sm">
      {active && (
        <Notice tone="info">
          {t(
            `Subscribed · accepted additional fee ${feeLabel(subscription!.acceptedFeeTenthsBp)}. Only this fee applies to your orders.`,
            `구독 중 · 동의한 추가 수수료 ${feeLabel(subscription!.acceptedFeeTenthsBp)}. 주문에는 이 수수료만 적용됩니다.`,
          )}
        </Notice>
      )}
      {reconsent && (
        <Notice tone="warn">
          {t(
            <>
              The bot&apos;s settings or fee changed, so re-consent is required ({feeLabel(subscription!.acceptedFeeTenthsBp)} →{" "}
              {feeLabel(subscription!.pendingFeeTenthsBp ?? feeTenthsBp)}). New orders from this bot are blocked until you re-consent.
            </>,
            <>
              봇 설정 또는 수수료가 변경되어 재동의가 필요합니다 ({feeLabel(subscription!.acceptedFeeTenthsBp)} →{" "}
              {feeLabel(subscription!.pendingFeeTenthsBp ?? feeTenthsBp)}). 재동의 전까지 이 봇의 신규 주문은 차단됩니다.
            </>,
          )}
        </Notice>
      )}
      {live && !active && (
        <>
          {w.me.config.network === "mainnet" && (
            <Notice tone="down">
              Mainnet: this bot places real orders with real funds in your Hyperliquid account, automatically, on every signal. You can lose
              money. Unsubscribe at any time to stop new orders.
            </Notice>
          )}
          {!reconsent && (
            <div>
              <label className="block text-xs text-muted" htmlFor="subscribe-amount">
                Amount per trade (USDC, max {maxOrderUsd})
              </label>
              <input
                id="subscribe-amount"
                type="number"
                min={11}
                max={maxOrderUsd}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="num mt-1 w-full"
              />
              <p className="mt-1 text-xs text-faint">The bot opens a position of this size on each entry signal, with a stop loss.</p>
            </div>
          )}
          <label className="flex items-start gap-2 text-text">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1" />
            <span>
              {t(
                <>
                  I understand the additional Builder Fee of <b>{feeLabel(feeTenthsBp)}</b> and the risks of loss, leverage and liquidation, and I agree
                  to this bot placing orders on my Hyperliquid account within its risk policy.
                </>,
                <>
                  추가 Builder Fee <b>{feeLabel(feeTenthsBp)}</b>와 손실·레버리지·강제청산 위험을 이해했으며, 이 봇이 내 Hyperliquid 계정에서
                  위험 정책 범위 내로 주문하는 것에 동의합니다.
                </>,
              )}
            </span>
          </label>
          <button
            className={buttonClass("primary") + " w-full"}
            disabled={!accept || busy}
            onClick={() =>
              run(`/api/bots/${botId}/subscribe`, { acceptedFeeTenthsBp: feeTenthsBp, acceptRisk: true, ...(reconsent ? {} : { orderUsd: Number(amount) }) })
            }
          >
            {reconsent ? t("Re-consent to changes", "변경 내용에 재동의") : t("Subscribe", "구독하기")}
          </button>
        </>
      )}
      {!live && !active && <p className="text-muted">{t("This bot is not accepting new subscriptions right now.", "현재 신규 구독을 받지 않는 봇입니다.")}</p>}
      {(active || reconsent) && (
        <button className={buttonClass("danger") + " w-full"} disabled={busy} onClick={() => run(`/api/bots/${botId}/unsubscribe`)}>
          {t("Unsubscribe (blocks new orders immediately)", "구독 중지 (신규 주문 즉시 차단)")}
        </button>
      )}
      <p className="text-xs text-faint">
        {t(
          <>
            Before live trading, you need to separately sign the Builder Fee approval and the trading permission (agent wallet) approval on the{" "}
            <Link href="/trade" className="underline">
              Trade
            </Link>{" "}
            page.
          </>,
          <>
            실거래 전 <Link href="/trade" className="underline">트레이딩</Link> 화면에서 Builder Fee 승인과 거래 권한(에이전트) 승인을 별도로 서명해야 합니다.
          </>,
        )}
      </p>
      {error && <Notice tone="down">{L(error)}</Notice>}
    </div>
  );
}

export function OwnerActions({ botId, status }: { botId: string; status: string }) {
  const { t, L } = useI18n();
  const { busy, error, run } = useAction();
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{t("You registered this bot.", "내가 등록한 봇입니다.")}</p>
      <div className="flex flex-wrap gap-2">
        <Link href={`/bots/register?edit=${botId}`} className={buttonClass("secondary", "sm")}>
          {t("Edit", "수정")}
        </Link>
        {(status === "DRAFT" || status === "REJECTED") && (
          <button className={buttonClass("primary", "sm")} disabled={busy} onClick={() => run(`/api/bots/${botId}/submit`)}>
            {t("Submit for review", "심사 요청")}
          </button>
        )}
        {(status === "APPROVED" || status === "PAUSED") && (
          <button className={buttonClass("primary", "sm")} disabled={busy} onClick={() => run(`/api/bots/${botId}/start`)}>
            {t("Publish to market (LIVE)", "마켓에 공개 (LIVE)")}
          </button>
        )}
        {status === "LIVE" && (
          <button className={buttonClass("danger", "sm")} disabled={busy} onClick={() => run(`/api/bots/${botId}/stop`)}>
            {t("Pause (blocks new orders)", "일시 중지 (신규 주문 차단)")}
          </button>
        )}
      </div>
      {error && <Notice tone="down">{L(error)}</Notice>}
    </div>
  );
}

/** Shown to the owner of an APPROVED bot: approval alone doesn't list it, so say so and offer the publish button. */
export function PublishBanner({ botId }: { botId: string }) {
  const { t, L } = useI18n();
  const { busy, error, run } = useAction();
  return (
    <div className="space-y-3 rounded-xl border border-accent/50 bg-accent/10 p-4 text-sm" data-testid="publish-banner">
      <p className="font-semibold text-text">{t("Approved — not in the bot market yet", "승인 완료 — 아직 봇 마켓에 보이지 않습니다")}</p>
      <p className="text-muted">
        {t(
          "Approval doesn't publish the bot. Press Publish to market (LIVE) to list it in the bot market so users can subscribe. You can pause it again at any time.",
          "승인만으로는 공개되지 않습니다. 마켓에 공개 (LIVE)를 눌러야 봇 마켓에 노출되고 사용자가 구독할 수 있습니다. 공개 후에도 언제든 일시 중지할 수 있습니다.",
        )}
      </p>
      <button className={buttonClass("primary", "sm")} disabled={busy} onClick={() => run(`/api/bots/${botId}/start`)}>
        {t("Publish to market (LIVE)", "마켓에 공개 (LIVE)")}
      </button>
      {error && <Notice tone="down">{L(error)}</Notice>}
    </div>
  );
}
