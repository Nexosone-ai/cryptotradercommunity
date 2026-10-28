"use client";

import { useCallback, useEffect, useState } from "react";
import { getAddress, type Abi, type Hex } from "viem";
import { useI18n } from "@/components/I18nProvider";
import { Badge, buttonClass, Card, Notice } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";
import { apiFetch } from "@/lib/client-api";
import { dateTime, shortAddress } from "@/lib/format";
import artifact from "@/lib/swap/artifact.json";
import { swapClients, walletErrorMessage } from "@/lib/swap/browser";
import { explorerAddress, explorerTx, type SwapChain } from "@/lib/swap/chains";

interface ChainView extends SwapChain {
  contractAddress: string | null;
  deployedAt: string | null;
}
interface Token {
  id: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  listed: boolean;
}

/**
 * Deploys the settlement contract from the admin's own wallet (no server-held
 * deployer key), then asks the server to verify the deployed code and record it.
 */
export function SwapAdmin() {
  const w = useWallet();
  const { t, L } = useI18n();
  const [chains, setChains] = useState<ChainView[]>([]);
  const [network, setNetwork] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  const [tokenChain, setTokenChain] = useState<number | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    apiFetch<{ network: string; chains: ChainView[] }>("/api/swap/config")
      .then((c) => {
        setChains(c.chains);
        setNetwork(c.network);
        setTokenChain((id) => id ?? c.chains[0]?.id ?? null);
      })
      .catch((e) => setMsg({ tone: "down", text: e.message }));
  }, [tick]);

  useEffect(() => {
    if (!tokenChain) return;
    apiFetch<{ tokens: Token[] }>(`/api/swap/tokens?chainId=${tokenChain}`)
      .then((d) => setTokens(d.tokens))
      .catch(() => setTokens([]));
  }, [tokenChain, tick]);

  async function deploy(chain: ChainView) {
    const provider = w.getProvider();
    if (!provider || !w.me?.user) return;
    setBusy(chain.id);
    setMsg(null);
    try {
      const c = await swapClients(provider, chain, getAddress(w.me.user.walletAddress));
      const hash = await c.wallet.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode as Hex });
      setMsg({ tone: "info", text: t(`Deployment transaction sent: ${hash}. Waiting for confirmation…`, `배포 트랜잭션 전송됨: ${hash}. 확인 대기 중…`) });
      const receipt = await c.pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(t("The deployment transaction failed.", "배포 트랜잭션이 실패했습니다."));
      await apiFetch("/api/admin/swap/deployments", { method: "POST", body: { chainId: chain.id, txHash: hash } });
      setMsg({ tone: "info", text: t(`Deployed and verified on ${chain.name}: ${explorerTx(chain, hash)}`, `${chain.name}에 배포·검증 완료: ${explorerTx(chain, hash)}`) });
      reload();
    } catch (e) {
      setMsg({ tone: "down", text: L(walletErrorMessage(e)) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {msg && <Notice tone={msg.tone}>{L(msg.text)}</Notice>}
      <Notice tone={network === "mainnet" ? "down" : "info"}>
        {network === "mainnet"
          ? t("Mainnet mode. Deploy only contracts that have passed an external audit.", "메인넷 모드입니다. 외부 감사를 마친 컨트랙트만 배포하세요.")
          : t(
              "Testnet mode. Deployment gas (test tokens) is paid from the admin wallet. The contract has no admin privileges, fees or upgradeability.",
              "테스트넷 모드입니다. 배포 가스비(테스트 토큰)는 관리자 지갑에서 나갑니다. 컨트랙트에는 관리자 권한·수수료·업그레이드 기능이 없습니다.",
            )}
      </Notice>
      <Card>
        <h2 className="mb-3 font-semibold">{t("Swap contract (CtcP2PSwap)", "스왑 컨트랙트 (CtcP2PSwap)")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <tbody className="divide-y divide-line">
              {chains.map((c) => (
                <tr key={c.id}>
                  <td className="py-2">
                    <b>{c.name}</b> <span className="num text-xs text-muted">chain {c.id}</span>
                  </td>
                  <td>
                    {c.contractAddress ? (
                      <a className="num text-accent underline" href={explorerAddress(c, c.contractAddress)} target="_blank" rel="noopener noreferrer">
                        {shortAddress(c.contractAddress)}
                      </a>
                    ) : (
                      <Badge tone="warn">{t("Not deployed", "미배포")}</Badge>
                    )}
                  </td>
                  <td className="num text-xs text-muted">{c.deployedAt ? t(`Verified ${dateTime(c.deployedAt)}`, `검증 ${dateTime(c.deployedAt)}`) : ""}</td>
                  <td className="text-right">
                    <button className={buttonClass(c.contractAddress ? "secondary" : "primary", "sm")} disabled={busy !== null} onClick={() => deploy(c)}>
                      {busy === c.id ? t("Deploying…", "배포 중…") : c.contractAddress ? t("Redeploy", "재배포") : t("Deploy with MetaMask", "MetaMask로 배포")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{t("Token verification (listed)", "토큰 검증 (listed)")}</h2>
          <select value={tokenChain ?? ""} onChange={(e) => setTokenChain(Number(e.target.value))} className="w-auto">
            {chains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {tokens.length === 0 ? (
          <p className="text-sm text-muted">{t("No tokens registered.", "등록된 토큰이 없습니다.")}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {tokens.map((tk) => (
                <tr key={tk.id}>
                  <td className="py-2">
                    <b>{tk.symbol}</b> <span className="text-muted">{tk.name}</span>
                  </td>
                  <td className="num text-xs">{tk.address}</td>
                  <td className="num text-xs">{tk.decimals} dec</td>
                  <td className="text-right">
                    <button
                      className={buttonClass(tk.listed ? "secondary" : "primary", "sm")}
                      onClick={async () => {
                        try {
                          await apiFetch(`/api/admin/swap/tokens/${tk.id}/list`, { method: "POST", body: { listed: !tk.listed } });
                          reload();
                        } catch (e) {
                          setMsg({ tone: "down", text: e instanceof Error ? L(e.message) : t("Failed", "실패") });
                        }
                      }}
                    >
                      {tk.listed ? t("Unlist", "검증 해제") : t("Mark as verified", "검증 표시")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
