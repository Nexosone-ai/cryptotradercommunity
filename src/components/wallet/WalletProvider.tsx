"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { stringToHex } from "viem";
import type { WalletChain } from "@/lib/chains";
import type { PublicConfig } from "@/lib/config";
import { apiFetch } from "@/lib/client-api";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
  isMetaMask?: boolean;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; rdns: string; icon: string };
  provider: Eip1193Provider;
}

export interface Me {
  user: { id: string; walletAddress: string; roles: string[] } | null;
  partner?: { referralCode: string; eligibilityStatus: string } | null;
  referredBy?: { code: string; since: string } | null;
  config: PublicConfig;
}

type Status = "idle" | "connecting" | "signing" | "verifying";

interface WalletCtx {
  me: Me | null;
  status: Status;
  error: string | null;
  notice: string | null;
  chainId: number | null;
  providerName: string | null;
  connectOpen: boolean;
  openConnect(): void;
  closeConnect(): void;
  signIn(acceptTerms: boolean): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  getProvider(): Eip1193Provider | null;
  clearNotice(): void;
}

const Ctx = createContext<WalletCtx | null>(null);

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet must be used within WalletProvider");
  return c;
}

export function isMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** Opens this page inside the MetaMask mobile in-app browser. */
/**
 * Asks the wallet to switch to the required chain, adding it if the wallet
 * does not know it (EIP-3326 / EIP-3085). Returns the chain id now active.
 */
export async function ensureWalletChain(provider: Eip1193Provider, chain: WalletChain): Promise<number> {
  const current = parseInt((await provider.request({ method: "eth_chainId" })) as string, 16);
  if (current === chain.id) return current;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.hex }] });
  } catch (err) {
    if ((err as { code?: number })?.code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chain.hex,
          chainName: chain.name,
          rpcUrls: [chain.rpcUrl],
          ...(chain.explorerUrl ? { blockExplorerUrls: [chain.explorerUrl] } : {}),
          nativeCurrency: chain.nativeCurrency,
        },
      ],
    });
  }
  const after = parseInt((await provider.request({ method: "eth_chainId" })) as string, 16);
  if (after !== chain.id) throw new Error(`지갑 네트워크를 ${chain.name}로 전환해 주세요.`);
  return after;
}

export function metamaskDeepLink() {
  if (typeof window === "undefined") return "https://metamask.io/download/";
  const { host, pathname, search } = window.location;
  return `https://metamask.app.link/dapp/${host}${pathname}${search}`;
}

function describeError(err: unknown): string {
  const e = err as { code?: number; message?: string };
  if (e?.code === 4001) return "MetaMask에서 요청을 거절했습니다.";
  if (e?.code === -32002) return "MetaMask에 처리 대기 중인 요청이 있습니다. MetaMask 창을 열어 확인해 주세요.";
  return e?.message || "지갑 연결 중 오류가 발생했습니다.";
}

export function WalletProvider({ children, initialMe }: { children: ReactNode; initialMe: Me | null }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(initialMe);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const discovered = useRef<Eip6963Detail[]>([]);
  const [providerName, setProviderName] = useState<string | null>(null);

  // EIP-6963 provider discovery (multiple injected wallets), with window.ethereum fallback.
  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<Eip6963Detail>).detail;
      if (detail && !discovered.current.some((d) => d.info.uuid === detail.info.uuid)) {
        discovered.current.push(detail);
        const mm = discovered.current.find((d) => d.info.rdns.startsWith("io.metamask"));
        setProviderName((mm ?? discovered.current[0]).info.name);
      }
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  const getProvider = useCallback((): Eip1193Provider | null => {
    const mm = discovered.current.find((d) => d.info.rdns.startsWith("io.metamask"));
    if (mm) return mm.provider;
    const eth = (window as unknown as { ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] } }).ethereum;
    if (!eth) return discovered.current[0]?.provider ?? null;
    return eth.providers?.find((p) => p.isMetaMask) ?? eth;
  }, []);

  const refresh = useCallback(async () => {
    const data = await apiFetch<Me>("/api/me");
    setMe(data);
  }, []);

  const signOut = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    await refresh();
    router.refresh();
  }, [refresh, router]);

  // Re-evaluate the session whenever the wallet account or chain changes.
  useEffect(() => {
    const provider = getProvider();
    if (!provider?.on) return;
    const onAccounts = (accounts: string[]) => {
      const current = accounts[0]?.toLowerCase();
      if (me?.user && current !== me.user.walletAddress) {
        setNotice(current ? "지갑 계정이 변경되어 로그아웃했습니다. 새 계정으로 다시 서명해 주세요." : "지갑 연결이 해제되어 로그아웃했습니다.");
        void signOut();
      }
    };
    const onChain = (hex: string) => setChainId(parseInt(hex, 16));
    const onDisconnect = () => {
      if (me?.user) {
        setNotice("지갑 연결이 해제되어 로그아웃했습니다.");
        void signOut();
      }
    };
    provider.on("accountsChanged", onAccounts as never);
    provider.on("chainChanged", onChain as never);
    provider.on("disconnect", onDisconnect as never);
    provider
      .request({ method: "eth_accounts" })
      .then((a) => onAccounts(a as string[]))
      .catch(() => {});
    provider
      .request({ method: "eth_chainId" })
      .then((c) => setChainId(parseInt(c as string, 16)))
      .catch(() => {});
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts as never);
      provider.removeListener?.("chainChanged", onChain as never);
      provider.removeListener?.("disconnect", onDisconnect as never);
    };
  }, [getProvider, me?.user, signOut, providerName]);

  const walletChain = me?.config.walletChain;
  const signIn = useCallback(
    async (acceptTerms: boolean) => {
      setError(null);
      const provider = getProvider();
      if (!provider) {
        setError(isMobileBrowser() ? "MetaMask 앱의 브라우저에서 열어 주세요." : "MetaMask 확장 프로그램을 찾을 수 없습니다.");
        return;
      }
      try {
        setStatus("connecting");
        const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
        const address = accounts[0];
        if (!address) throw new Error("연결된 계정이 없습니다.");
        const required = walletChain;
        const chain = required
          ? await ensureWalletChain(provider, required)
          : parseInt((await provider.request({ method: "eth_chainId" })) as string, 16);
        setChainId(chain);
        const { message } = await apiFetch<{ message: string }>("/api/auth/nonce", {
          method: "POST",
          body: { address, chainId: chain },
        });
        setStatus("signing");
        const signature = (await provider.request({ method: "personal_sign", params: [stringToHex(message), address] })) as string;
        setStatus("verifying");
        await apiFetch("/api/auth/verify", { method: "POST", body: { message, signature, acceptTerms } });
        await refresh();
        setConnectOpen(false);
        router.refresh();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setStatus("idle");
      }
    },
    [getProvider, refresh, router, walletChain],
  );

  const value = useMemo<WalletCtx>(
    () => ({
      me,
      status,
      error,
      notice,
      chainId,
      providerName,
      connectOpen,
      openConnect: () => {
        setError(null);
        setConnectOpen(true);
      },
      closeConnect: () => setConnectOpen(false),
      signIn,
      signOut,
      refresh,
      getProvider,
      clearNotice: () => setNotice(null),
    }),
    [me, status, error, notice, chainId, providerName, connectOpen, signIn, signOut, refresh, getProvider],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
