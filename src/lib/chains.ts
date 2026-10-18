/**
 * EVM networks the user's wallet must be on. This is only the chain the wallet
 * signs on (SIWE login and Hyperliquid user-signed actions such as
 * approveBuilderFee/approveAgent, via `signatureChainId`) — Hyperliquid itself
 * runs on its own L1, testnet or mainnet, independently of this chain.
 */
export interface WalletChain {
  id: number;
  hex: `0x${string}`;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export const WALLET_CHAINS: Record<number, WalletChain> = {
  11155111: {
    id: 11155111,
    hex: "0xaa36a7",
    name: "Ethereum Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  },
  421614: {
    id: 421614,
    hex: "0x66eee",
    name: "Arbitrum Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorerUrl: "https://sepolia.arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  42161: {
    id: 42161,
    hex: "0xa4b1",
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
};

/** Testnet signs on Ethereum Sepolia; mainnet on Arbitrum One. */
export const DEFAULT_WALLET_CHAIN = { testnet: 11155111, mainnet: 42161 } as const;
