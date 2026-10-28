"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { buttonClass, Notice } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";
import { apiFetch } from "@/lib/client-api";

export function ActivatePartner() {
  const w = useWallet();
  const { t, L } = useI18n();
  const [accept, setAccept] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const existing = w.me?.partner?.referralCode ?? code;

  if (existing) {
    return (
      <Notice tone="info">
        {t(
          <>
            Your partner code <b>{existing}</b> is active. <Link href="/partner" className="underline">Partner dashboard</Link>
          </>,
          <>
            파트너 코드 <b>{existing}</b>가 활성화되어 있습니다. <Link href="/partner" className="underline">파트너 대시보드</Link>
          </>,
        )}
      </Notice>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-line bg-panel p-4 sm:p-5" data-testid="activate-partner">
      <label className="flex items-start gap-2 text-sm text-text">
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1" />
        {t(
          "I agree to the partner terms (no false or exaggerated advertising, no guaranteed-return claims, no multiple accounts; payouts are withheld on policy violations).",
          "파트너 약관(허위·과장 광고 금지, 수익 보장 표현 금지, 다중 계정 금지, 정책 위반 시 지급 보류)에 동의합니다.",
        )}
      </label>
      <button
        className={buttonClass("primary")}
        disabled={!accept}
        onClick={async () => {
          try {
            const r = await apiFetch<{ referralCode: string }>("/api/partner/activate", { method: "POST", body: { acceptPartnerTerms: true } });
            setCode(r.referralCode);
            await w.refresh();
            router.refresh();
          } catch (e) {
            setErr(e instanceof Error ? L(e.message) : t("Failed", "실패"));
          }
        }}
      >
        {t("Become a partner", "파트너 시작하기")}
      </button>
      {err && <Notice tone="down">{err}</Notice>}
    </div>
  );
}
