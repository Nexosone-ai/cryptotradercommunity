"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { buttonClass } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";
import { apiFetch } from "@/lib/client-api";

export function CaptureReferral({ code }: { code: string }) {
  const w = useWallet();
  const { t } = useI18n();
  const [stored, setStored] = useState<boolean | null>(null);
  useEffect(() => {
    apiFetch<{ stored: boolean }>("/api/referral/capture", { method: "POST", body: { code } })
      .then((r) => setStored(r.stored))
      .catch(() => setStored(false));
  }, [code]);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {stored === null
          ? t("Saving referral code…", "추천 코드 저장 중…")
          : stored
            ? t("✓ Referral code saved.", "✓ 추천 코드가 저장되었습니다.")
            : t("Couldn't save the referral code.", "추천 코드를 저장하지 못했습니다.")}
      </p>
      <button className={buttonClass("primary") + " w-full py-3"} onClick={w.openConnect} disabled={!stored}>
        {t("Sign up with MetaMask", "MetaMask로 가입하기")}
      </button>
    </div>
  );
}
