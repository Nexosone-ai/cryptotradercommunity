"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Notice, Stat } from "@/components/ui";
import { UsdcBalances, type UsdcBalancesView } from "@/components/UsdcBalances";
import { apiFetch } from "@/lib/client-api";
import { usd } from "@/lib/format";

interface AccountView {
  fetchedAt: string;
  hlError: string | null;
  state: {
    marginSummary?: { accountValue: string; totalMarginUsed: string; totalNtlPos: string };
    withdrawable?: string;
    assetPositions?: { position: { coin: string; unrealizedPnl: string } }[];
  } | null;
  spot: UsdcBalancesView["spot"];
  hyperEvm: UsdcBalancesView["hyperEvm"];
  agent: { address: string } | null;
  builder: { approvedMaxTenthsBp: number | null };
}

export function HlAccountSummary() {
  const { t, L, intl } = useI18n();
  const [a, setA] = useState<AccountView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch<AccountView>("/api/trading/account")
      .then(setA)
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);
  if (err) return <Notice tone="down">{L(err)}</Notice>;
  if (!a) return <p className="text-sm text-muted">{t("Loading from Hyperliquid…", "Hyperliquid에서 불러오는 중…")}</p>;
  const ms = a.state?.marginSummary;
  const upnl = (a.state?.assetPositions ?? []).reduce((s, p) => s + Number(p.position.unrealizedPnl), 0);
  const agentLabel = a.agent ? t("approved", "승인됨") : t("not approved", "미승인");
  const builderLabel = a.builder.approvedMaxTenthsBp ? `${a.builder.approvedMaxTenthsBp / 1000}%` : t("none", "없음");
  const time = new Date(a.fetchedAt).toLocaleTimeString(intl, { hour12: false });
  return (
    <div className="space-y-3">
      {a.hlError && <Notice tone="down">{L(a.hlError)}</Notice>}
      <UsdcBalances
        view={{ perpsValue: ms?.accountValue ?? null, perpsWithdrawable: a.state?.withdrawable ?? null, spot: a.spot, hyperEvm: a.hyperEvm }}
        onChange={load}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Account value", "계정 가치")} value={usd(ms?.accountValue)} />
        <Stat label={t("Withdrawable", "출금 가능")} value={usd(a.state?.withdrawable)} />
        <Stat label={t("Margin used", "사용 증거금")} value={usd(ms?.totalMarginUsed)} />
        <Stat label={t("Unrealized PnL", "미실현손익")} value={usd(upnl)} tone={upnl >= 0 ? "up" : "down"} />
        <Stat label={t("Positions", "포지션 수")} value={a.state?.assetPositions?.length ?? 0} />
      </div>
      <p className="text-xs text-faint">
        {t(
          <>
            Trading permission {agentLabel} · Builder Fee approval {builderLabel} · as of Hyperliquid {time}
          </>,
          <>
            거래 권한 {agentLabel} · Builder Fee 승인 {builderLabel} · Hyperliquid{" "}
            {time} 기준
          </>,
        )}
      </p>
    </div>
  );
}
