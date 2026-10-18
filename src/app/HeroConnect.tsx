"use client";

import { buttonClass, LinkButton } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";

export function HeroConnect() {
  const w = useWallet();
  if (w.me?.user) return <LinkButton href="/trade">트레이딩 시작</LinkButton>;
  return (
    <button className={buttonClass("primary") + " px-6"} onClick={w.openConnect}>
      MetaMask로 시작하기
    </button>
  );
}
