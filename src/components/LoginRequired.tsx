"use client";

import { useI18n } from "./I18nProvider";
import { buttonClass } from "./ui";
import { useWallet } from "./wallet/WalletProvider";

export function LoginRequired({ title, desc }: { title: string; desc?: string }) {
  const w = useWallet();
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-line bg-panel p-8 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      {desc && <p className="mt-3 text-sm text-muted">{desc}</p>}
      <button className={buttonClass("primary") + " mt-6"} onClick={w.openConnect}>
        {t("Connect MetaMask", "MetaMask 연결")}
      </button>
    </div>
  );
}
