"use client";

import { createPublicClient, createWalletClient, custom, defineChain, erc20Abi, type Abi, type Address } from "viem";
import { ensureWalletChain, type Eip1193Provider } from "@/components/wallet/WalletProvider";
import type { SwapChain } from "./chains";
import { bi } from "../i18n";

/** viem clients bound to the user's wallet, after switching it to `chain`. */
export async function swapClients(provider: Eip1193Provider, chain: SwapChain, account: Address) {
  await ensureWalletChain(provider, chain);
  const viemChain = defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: { default: { http: [chain.rpcUrl] } },
    blockExplorers: { default: { name: "Explorer", url: chain.explorerUrl } },
    testnet: chain.testnet,
  });
  const transport = custom(provider);
  return {
    wallet: createWalletClient({ account, chain: viemChain, transport }),
    pub: createPublicClient({ chain: viemChain, transport }),
  };
}

type Clients = Awaited<ReturnType<typeof swapClients>>;

/** Approves exactly `amount` if the current allowance is lower. Returns true if a tx was sent. */
export async function ensureAllowance(c: Clients, token: Address, spender: Address, amount: bigint): Promise<boolean> {
  const owner = c.wallet.account.address;
  const current = await c.pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
  if (current >= amount) return false;
  const hash = await c.wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
  const receipt = await c.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(bi("The token approval (approve) transaction failed.", "토큰 승인(approve) 트랜잭션이 실패했습니다."));
  return true;
}

export async function tokenBalance(c: Clients, token: Address): Promise<bigint> {
  return c.pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [c.wallet.account.address] });
}

export function walletErrorMessage(err: unknown): string {
  const e = err as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } };
  if (e?.code === 4001 || e?.cause?.code === 4001) return bi("The request was rejected in your wallet.", "지갑에서 요청을 거절했습니다.");
  return e?.shortMessage || e?.message || bi("Something went wrong with the wallet request.", "지갑 요청 중 오류가 발생했습니다.");
}

export type SwapAbi = Abi;
