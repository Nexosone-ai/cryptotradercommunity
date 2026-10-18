"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "@/components/ui";
import { isMobileBrowser, metamaskDeepLink, useWallet } from "./WalletProvider";

/**
 * MetaMask connect dialog. Per the design brief it uses an opaque black
 * background with white text for maximum contrast.
 */
export function ConnectModal() {
  const w = useWallet();
  const [accept, setAccept] = useState(false);
  if (!w.connectOpen) return null;
  const hasProvider = typeof window !== "undefined" && Boolean(w.getProvider());
  const mobile = isMobileBrowser();
  const busy = w.status !== "idle";
  const step = { idle: "", connecting: "MetaMask 계정·네트워크 확인 중…", signing: "MetaMask에서 로그인 메시지에 서명해 주세요…", verifying: "서명 확인 중…" }[w.status];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="connect-title">
      <div className="w-full max-w-md rounded-t-2xl border border-white/20 bg-black p-6 text-white sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="connect-title" className="text-xl font-bold">
            MetaMask로 로그인
          </h2>
          <button onClick={w.closeConnect} className="text-white/70 hover:text-white" aria-label="닫기">
            ✕
          </button>
        </div>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-white">
          <li>• 이메일·비밀번호 없이 지갑 서명만으로 로그인합니다.</li>
          <li>• 로그인 서명은 <b>거래 권한이나 수수료 승인을 부여하지 않습니다.</b> 가스비도 들지 않습니다.</li>
          <li>• 비밀복구구문(시드)이나 개인키는 절대 요청하지 않습니다.</li>
          {w.me?.config.walletChain && (
            <li>
              • 지갑 네트워크는 <b>{w.me.config.walletChain.name}</b>을(를) 사용합니다. 다른 네트워크면 MetaMask가 전환을 요청합니다.
            </li>
          )}
        </ul>

        {hasProvider ? (
          <>
            <label className="mt-5 flex items-start gap-3 text-sm text-white">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1" />
              <span>
                <Link href="/docs#terms" className="underline" target="_blank">
                  이용약관
                </Link>
                과{" "}
                <Link href="/docs#risk" className="underline" target="_blank">
                  위험 고지
                </Link>
                (손실·레버리지·강제청산 위험, 과거 수익률 비보장)를 읽었으며 동의합니다.
              </span>
            </label>
            <button
              className={buttonClass("primary") + " mt-5 w-full py-3 text-base"}
              disabled={!accept || busy}
              onClick={() => w.signIn(accept)}
            >
              {busy ? step : `${w.providerName ?? "MetaMask"} 연결하고 서명하기`}
            </button>
          </>
        ) : mobile ? (
          <div className="mt-5 space-y-3 text-sm text-white">
            <p>모바일에서는 MetaMask 앱 안의 브라우저에서 이 페이지를 열어야 연결할 수 있습니다.</p>
            <a href={metamaskDeepLink()} className={buttonClass("primary") + " w-full py-3 text-base"}>
              MetaMask 앱에서 열기
            </a>
            <p className="text-white/70">앱이 없다면 App Store / Google Play에서 MetaMask를 설치한 뒤 다시 시도하세요.</p>
          </div>
        ) : (
          <div className="mt-5 space-y-3 text-sm text-white">
            <p>MetaMask 확장 프로그램이 감지되지 않았습니다. 설치 후 이 페이지를 새로고침하세요.</p>
            <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" className={buttonClass("primary") + " w-full py-3"}>
              MetaMask 설치하기
            </a>
          </div>
        )}

        {w.error && (
          <p role="alert" className="mt-4 rounded-lg border border-red-400/60 bg-red-950 px-3 py-2 text-sm text-white">
            {w.error}
          </p>
        )}
      </div>
    </div>
  );
}
