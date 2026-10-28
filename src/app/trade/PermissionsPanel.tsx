"use client";

import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { buttonClass, Notice } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";
import { apiFetch } from "@/lib/client-api";
import type { PublicConfig } from "@/lib/config";
import { dateTime, feeLabel, shortAddress } from "@/lib/format";
import { hlErrorMessage, userExchange } from "@/lib/hl-browser";

export interface AccountPermissions {
  agent: { address: string; validUntil: string; status: string } | null;
  builder: { address: string | null; approvedMaxTenthsBp: number | null; verifiedAt: string | null };
}

/**
 * Two separate, explicit approvals — both signed by the user's main wallet:
 * 1) Builder fee (max rate the platform may add per order)
 * 2) Agent wallet (lets the platform's order gate sign orders; cannot withdraw)
 */
export function PermissionsPanel({ config, perms, onChange }: { config: PublicConfig; perms: AccountPermissions | null; onChange: () => void }) {
  const w = useWallet();
  const { t, L } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(Math.max(config.platformMaxFeeTenthsBp, 1));
  const address = w.me?.user?.walletAddress;

  async function approveBuilder() {
    const provider = w.getProvider();
    if (!provider || !address) return;
    setBusy("builder");
    setError(null);
    try {
      const ch = await apiFetch<{ builder: `0x${string}`; maxFeeRate: string }>("/api/fees/approval/challenge", {
        method: "POST",
        body: { requiredTenthsBp: rate },
      });
      await (await userExchange(provider, address, config.network, config.walletChain)).approveBuilderFee({ builder: ch.builder, maxFeeRate: ch.maxFeeRate });
      await apiFetch("/api/fees/approval");
      onChange();
    } catch (e) {
      setError(hlErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function approveAgent() {
    const provider = w.getProvider();
    if (!provider || !address) return;
    setBusy("agent");
    setError(null);
    try {
      const a = await apiFetch<{ agentAddress: `0x${string}`; agentName: string }>("/api/trading/agent", { method: "POST", body: {} });
      await (await userExchange(provider, address, config.network, config.walletChain)).approveAgent({ agentAddress: a.agentAddress, agentName: a.agentName });
      await apiFetch("/api/trading/agent/verify", { method: "POST", body: {} });
      onChange();
    } catch (e) {
      setError(hlErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function revokeAgent() {
    setBusy("revoke");
    try {
      await apiFetch("/api/trading/agent", { method: "DELETE" });
      onChange();
    } finally {
      setBusy(null);
    }
  }

  const approved = perms?.builder.approvedMaxTenthsBp ?? null;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-muted">
        {t(
          "Signing in and trading permission are separate. Each of the two approvals below needs its own MetaMask signature, and your assets stay in your own Hyperliquid account.",
          "로그인과 거래 권한은 별개입니다. 아래 두 승인은 각각 MetaMask 서명이 필요하며, 자산은 계속 본인 Hyperliquid 계정에 남습니다.",
        )}
      </p>

      <div className="rounded-lg border border-line p-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t("① Builder Fee approval", "① Builder Fee 승인")}</h3>
          <span className={approved ? "text-up" : "text-muted"}>
            {approved
              ? t(`Up to ${L(feeLabel(approved))} approved`, `최대 ${L(feeLabel(approved))} 승인됨`)
              : t("Not approved", "미승인")}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {(() => {
            const builder = config.builderAddress ? shortAddress(config.builderAddress) : t("not set", "미설정");
            return t(
              <>
                This is the cap on the fee the platform Builder address ({builder}) may add to each order. The fee actually applied is the one
                you agreed to when subscribing to a bot, and any order above the cap is rejected by both the server and Hyperliquid.
              </>,
              <>
                플랫폼 Builder 주소({builder})가 주문마다 추가할 수 있는 수수료의 상한입니다. 실제
                적용 수수료는 봇 구독 시 동의한 값이며, 상한을 넘는 주문은 서버와 Hyperliquid 모두에서 거부됩니다.
              </>,
            );
          })()}
        </p>
        {config.builderAddress ? (
          <div className="mt-3 flex items-center gap-2">
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))} className="w-auto">
              {[1, 5, 10, 20, 30, 50, 100]
                .filter((v) => v <= config.platformMaxFeeTenthsBp)
                .map((v) => (
                  <option key={v} value={v}>
                    {t(`Up to ${L(feeLabel(v))}`, `최대 ${L(feeLabel(v))}`)}
                  </option>
                ))}
            </select>
            <button className={buttonClass("secondary", "sm")} disabled={busy !== null} onClick={approveBuilder}>
              {busy === "builder" ? t("Confirm in MetaMask…", "MetaMask 확인 중…") : t("Sign to approve", "서명하여 승인")}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-warn">
            {t(
              "Builder Fee approval is unavailable because the operator hasn't set BUILDER_ADDRESS.",
              "운영자가 BUILDER_ADDRESS를 설정하지 않아 Builder Fee 승인을 사용할 수 없습니다.",
            )}
          </p>
        )}
        {perms?.builder.verifiedAt && (
          <p className="mt-2 text-[11px] text-faint">
            {t(
              <>Verified on Hyperliquid {L(dateTime(perms.builder.verifiedAt))}</>,
              <>Hyperliquid 확인 {L(dateTime(perms.builder.verifiedAt))}</>,
            )}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-line p-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t("② Trading permission (Agent Wallet)", "② 거래 권한 (Agent Wallet)")}</h3>
          <span className={perms?.agent ? "text-up" : "text-muted"}>{perms?.agent ? t("Active", "활성") : t("Not approved", "미승인")}</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {t(
            <>
              Registers a dedicated agent wallet created by the server with Hyperliquid. The agent can only sign orders and cannot withdraw.
              Its private key is stored encrypted on the server and never shown on screen or in logs. Order limits are enforced by the
              platform server&apos;s order gate, not by the protocol.
            </>,
            <>
              서버가 생성한 전용 에이전트 지갑을 Hyperliquid에 등록합니다. 에이전트는 주문 서명만 할 수 있으며 출금 권한이 없습니다. 개인키는 서버에서
              암호화 보관되며 화면이나 로그에 노출되지 않습니다. 주문 범위 제한은 프로토콜이 아니라 플랫폼 서버의 주문 게이트가 강제합니다.
            </>,
          )}
        </p>
        {perms?.agent ? (
          <div className="mt-2 space-y-2 text-xs">
            <p>
              {t(
                <>
                  Agent <span className="num">{shortAddress(perms.agent.address)}</span> · expires {L(dateTime(perms.agent.validUntil))}
                </>,
                <>
                  에이전트 <span className="num">{shortAddress(perms.agent.address)}</span> · 만료 {L(dateTime(perms.agent.validUntil))}
                </>,
              )}
            </p>
            <button className={buttonClass("danger", "sm")} disabled={busy !== null} onClick={revokeAgent}>
              {t("Stop using on the platform", "플랫폼 사용 중지")}
            </button>
            <p className="text-faint">
              {t(
                "To remove the agent from Hyperliquid itself, delete it in the API settings of the Hyperliquid app.",
                "Hyperliquid에서 에이전트 자체를 제거하려면 Hyperliquid 앱의 API 설정에서 삭제하세요.",
              )}
            </p>
          </div>
        ) : config.tradingAvailable ? (
          <button className={buttonClass("secondary", "sm") + " mt-3"} disabled={busy !== null} onClick={approveAgent}>
            {busy === "agent"
              ? t("Confirm in MetaMask…", "MetaMask 확인 중…")
              : t("Sign to approve trading permission", "서명하여 거래 권한 승인")}
          </button>
        ) : (
          <p className="mt-2 text-xs text-warn">
            {config.network === "mainnet" && !config.mainnetTradingEnabled
              ? t("Mainnet trading is not enabled.", "메인넷 거래가 활성화되지 않았습니다.")
              : t(
                  "Delegating trading permission is unavailable because the operator hasn't set up agent key encryption (AGENT_KEY_ENCRYPTION_KEY).",
                  "운영자가 에이전트 키 암호화(AGENT_KEY_ENCRYPTION_KEY)를 설정하지 않아 거래 권한 위임을 사용할 수 없습니다.",
                )}
          </p>
        )}
      </div>
      {error && <Notice tone="down">{L(error)}</Notice>}
    </div>
  );
}
