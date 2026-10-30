import { SWAP_MAINNETS, SWAP_TESTNETS, type SwapChain } from "./chains";

/**
 * Swap chains in use. Testnets by default. Mainnets need BOTH
 * SWAP_NETWORK=mainnet and SWAP_MAINNET_ENABLED=true, which must only be set
 * after the settlement contract has passed an external audit.
 */
export function getSwapConfig() {
  const wantsMainnet = process.env.SWAP_NETWORK === "mainnet";
  const mainnetEnabled = wantsMainnet && process.env.SWAP_MAINNET_ENABLED === "true";
  const chains: SwapChain[] = (mainnetEnabled ? SWAP_MAINNETS : SWAP_TESTNETS).map((c) => ({
    ...c,
    rpcUrl: process.env[`SWAP_RPC_${c.id}`] || c.rpcUrl,
  }));
  return { network: mainnetEnabled ? ("mainnet" as const) : ("testnet" as const), chains };
}

/** The swap page is open to users only with SWAP_OPEN=true; otherwise it shows "opening soon" (admins still see it). */
export function swapOpen() {
  return process.env.SWAP_OPEN === "true";
}

export function enabledSwapChain(chainId: number): SwapChain | undefined {
  return getSwapConfig().chains.find((c) => c.id === chainId);
}

/** Max order lifetime accepted by the server. */
export const MAX_ORDER_LIFETIME_SEC = 90 * 24 * 60 * 60;
