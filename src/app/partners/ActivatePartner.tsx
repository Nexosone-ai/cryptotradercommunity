"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClass, Card, Notice } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";
import { apiFetch } from "@/lib/client-api";

export function ActivatePartner() {
  const w = useWallet();
  const [accept, setAccept] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const existing = w.me?.partner?.referralCode ?? code;

  if (!w.me?.user) {
    return (
      <Card className="text-center">
        <p className="text-sm text-muted">파트너로 참여하려면 지갑으로 로그인하세요.</p>
        <button className={buttonClass("primary") + " mt-3"} onClick={w.openConnect}>
          MetaMask 연결
        </button>
      </Card>
    );
  }
  if (existing) {
    return (
      <Notice tone="info">
        파트너 코드 <b>{existing}</b>가 활성화되어 있습니다. <Link href="/partner" className="underline">파트너 대시보드</Link>
      </Notice>
    );
  }
  return (
    <Card className="space-y-3">
      <label className="flex items-start gap-2 text-sm text-text">
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1" />
        파트너 약관(허위·과장 광고 금지, 수익 보장 표현 금지, 다중 계정 금지, 정책 위반 시 지급 보류)에 동의합니다.
      </label>
      <button
        className={buttonClass("primary")}
        disabled={!accept}
        onClick={async () => {
          try {
            const r = await apiFetch<{ referralCode: string }>("/api/partner/activate", { method: "POST", body: { acceptPartnerTerms: true } });
            setCode(r.referralCode);
            await w.refresh();
          } catch (e) {
            setErr(e instanceof Error ? e.message : "실패");
          }
        }}
      >
        파트너 시작하기
      </button>
      {err && <Notice tone="down">{err}</Notice>}
    </Card>
  );
}
