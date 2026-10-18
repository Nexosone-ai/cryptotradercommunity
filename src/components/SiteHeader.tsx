"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { shortAddress } from "@/lib/format";
import { buttonClass, cx } from "./ui";
import { ConnectModal } from "./wallet/ConnectModal";
import { useWallet } from "./wallet/WalletProvider";

// Public menu only. /partner and /admin are intentionally not linked here;
// they are protected by server-side role checks regardless.
const NAV = [
  { href: "/bots", label: "봇 마켓" },
  { href: "/trade", label: "트레이딩" },
  { href: "/rankings", label: "랭킹" },
  { href: "/partners", label: "파트너 안내" },
  { href: "/portfolio", label: "마이페이지" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const w = useWallet();
  const [menu, setMenu] = useState(false);
  const network = w.me?.config.network ?? "testnet";

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="rounded-md bg-accent px-1.5 py-0.5 text-sm text-black">CTC</span>
          <span className="hidden text-sm sm:inline">CryptoTraderCommunity</span>
        </Link>
        <span
          className={cx(
            "rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            network === "mainnet" ? "border-down/60 text-down" : "border-warn/60 text-warn",
          )}
          title="Hyperliquid 네트워크"
        >
          {network === "mainnet" ? "Mainnet" : "Testnet"}
        </span>
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "rounded-md px-3 py-1.5 text-sm",
                pathname.startsWith(n.href) ? "bg-panel-2 text-text" : "text-muted hover:text-text",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {w.me?.user ? (
            <>
              <Link href="/portfolio" className="num hidden rounded-lg border border-line-strong px-3 py-1.5 text-xs sm:block">
                {shortAddress(w.me.user.walletAddress)}
              </Link>
              <button className={buttonClass("ghost", "sm")} onClick={() => w.signOut()}>
                로그아웃
              </button>
            </>
          ) : (
            <button className={buttonClass("primary", "sm") + " px-4"} onClick={w.openConnect} data-testid="connect-wallet">
              MetaMask 연결
            </button>
          )}
          <button className="rounded-md p-2 text-muted md:hidden" onClick={() => setMenu((m) => !m)} aria-label="메뉴" aria-expanded={menu}>
            ☰
          </button>
        </div>
      </div>
      {menu && (
        <nav className="border-t border-line px-4 py-2 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setMenu(false)} className="block rounded-md px-2 py-2.5 text-sm text-text">
              {n.label}
            </Link>
          ))}
        </nav>
      )}
      {w.notice && (
        <div className="border-t border-warn/40 bg-warn/10 px-4 py-2 text-center text-sm text-warn">
          {w.notice}{" "}
          <button className="underline" onClick={w.clearNotice}>
            닫기
          </button>
        </div>
      )}
    </header>
    {/* Outside <header>: its backdrop-filter would become the containing block of this fixed dialog. */}
    <ConnectModal />
    </>
  );
}
