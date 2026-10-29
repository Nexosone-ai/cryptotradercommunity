import "server-only";
import Decimal from "decimal.js";
import { createPublicClient, erc20Abi, http } from "viem";
import { WALLET_CHAINS } from "../chains";
import type { HlNetwork } from "../config";

/** Circle USDC on HyperEVM. Testnet has no canonical USDC, so only mainnet is read. */
const HYPEREVM_USDC: Partial<Record<HlNetwork, `0x${string}`>> = {
  mainnet: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
};
const HYPEREVM_CHAIN: Record<HlNetwork, number> = { mainnet: 999, testnet: 998 };

/**
 * USDC and HYPE (gas) on HyperEVM. USDC here is NOT tradable on Hyperliquid
 * until it is moved to HyperCore (that move needs a little HYPE for gas).
 */
export async function hyperEvmBalances(network: HlNetwork, address: string): Promise<{ usdc: string | null; hype: string }> {
  const chain = WALLET_CHAINS[HYPEREVM_CHAIN[network]];
  const client = createPublicClient({ transport: http(chain.rpcUrl, { timeout: 8_000 }) });
  const token = HYPEREVM_USDC[network];
  const [usdc, hype] = await Promise.all([
    token
      ? client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] })
      : Promise.resolve(null),
    client.getBalance({ address: address as `0x${string}` }),
  ]);
  return {
    usdc: usdc === null ? null : new Decimal(usdc.toString()).div(1e6).toFixed(),
    hype: new Decimal(hype.toString()).div(1e18).toFixed(),
  };
}
