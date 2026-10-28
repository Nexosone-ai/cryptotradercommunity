"use client";

import { useI18n } from "@/components/I18nProvider";
import { buttonClass, LinkButton } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";

export function HeroConnect() {
  const w = useWallet();
  const { t } = useI18n();
  if (w.me?.user) return <LinkButton href="/trade">{t("Start trading", "트레이딩 시작")}</LinkButton>;
  return (
    <button className={buttonClass("primary") + " px-6"} onClick={w.openConnect}>
      {t("Get started with MetaMask", "MetaMask로 시작하기")}
    </button>
  );
}
