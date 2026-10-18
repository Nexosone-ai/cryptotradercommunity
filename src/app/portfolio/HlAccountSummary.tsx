"use client";

import { useEffect, useState } from "react";
import { Notice, Stat } from "@/components/ui";
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
  agent: { address: string } | null;
  builder: { approvedMaxTenthsBp: number | null };
}

export function HlAccountSummary() {
  const [a, setA] = useState<AccountView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<AccountView>("/api/trading/account")
      .then(setA)
      .catch((e) => setErr(e.message));
  }, []);
  if (err) return <Notice tone="down">{err}</Notice>;
  if (!a) return <p className="text-sm text-muted">Hyperliquid에서 불러오는 중…</p>;
  const ms = a.state?.marginSummary;
  const upnl = (a.state?.assetPositions ?? []).reduce((s, p) => s + Number(p.position.unrealizedPnl), 0);
  return (
    <div className="space-y-3">
      {a.hlError && <Notice tone="down">{a.hlError}</Notice>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="계정 가치" value={usd(ms?.accountValue)} />
        <Stat label="출금 가능" value={usd(a.state?.withdrawable)} />
        <Stat label="사용 증거금" value={usd(ms?.totalMarginUsed)} />
        <Stat label="미실현손익" value={usd(upnl)} tone={upnl >= 0 ? "up" : "down"} />
        <Stat label="포지션 수" value={a.state?.assetPositions?.length ?? 0} />
      </div>
      <p className="text-xs text-faint">
        거래 권한 {a.agent ? "승인됨" : "미승인"} · Builder Fee 승인 {a.builder.approvedMaxTenthsBp ? `${a.builder.approvedMaxTenthsBp / 1000}%` : "없음"} · Hyperliquid{" "}
        {new Date(a.fetchedAt).toLocaleTimeString("ko-KR", { hour12: false })} 기준
      </p>
    </div>
  );
}
