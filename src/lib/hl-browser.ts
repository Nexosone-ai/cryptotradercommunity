"use client";

import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { createWalletClient, custom } from "viem";
import { ensureWalletChain, type Eip1193Provider } from "@/components/wallet/WalletProvider";
import type { WalletChain } from "@/lib/chains";

/**
 * Exchange client signed by the user's own MetaMask wallet. Used only for
 * user-signed actions that must come from the main wallet: approveBuilderFee
 * and approveAgent. Orders are signed by the approved agent on the server.
 * The wallet is switched to the configured chain first and that chain is used
 * as the EIP-712 signatureChainId (testnet: Ethereum Sepolia).
 */
export async function userExchange(provider: Eip1193Provider, address: string, network: "testnet" | "mainnet", chain: WalletChain) {
  await ensureWalletChain(provider, chain);
  const wallet = createWalletClient({ account: address as `0x${string}`, transport: custom(provider) });
  return new ExchangeClient({
    transport: new HttpTransport({ isTestnet: network === "testnet" }),
    wallet,
    signatureChainId: chain.hex,
  });
}

export function hlErrorMessage(err: unknown): string {
  const e = err as { code?: number; message?: string; cause?: { code?: number } };
  if (e?.code === 4001 || e?.cause?.code === 4001) return "MetaMask에서 서명을 거절했습니다.";
  const msg = e?.message ?? String(err);
  if (/Must deposit before performing actions/i.test(msg)) return "Hyperliquid 계정에 먼저 USDC를 입금해야 승인할 수 있습니다.";
  return msg;
}
