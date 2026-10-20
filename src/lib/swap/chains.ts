/**
 * EVM chains for the P2P swap module. Testnets are the default; mainnets are
 * listed but stay locked until SWAP_MAINNET_ENABLED=true (after an external
 * contract audit — docs/SWAP.md). Chain IDs and RPCs were checked live with
 * eth_chainId on 2026-10-20.
 */
export interface SwapChain {
  id: number;
  hex: `0x${string}`;
  name: string;
  shortName: string;
  /** Token standard as users know it on this chain. */
  tokenStandard: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  testnet: boolean;
}

export const SWAP_TESTNETS: SwapChain[] = [
  {
    id: 11155111,
    hex: "0xaa36a7",
    name: "Ethereum Sepolia",
    shortName: "Ethereum",
    tokenStandard: "ERC-20",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    testnet: true,
  },
  {
    id: 97,
    hex: "0x61",
    name: "BNB Smart Chain Testnet",
    shortName: "BNB Chain",
    tokenStandard: "BEP-20",
    rpcUrl: "https://bsc-testnet-rpc.publicnode.com",
    explorerUrl: "https://testnet.bscscan.com",
    nativeCurrency: { name: "Test BNB", symbol: "tBNB", decimals: 18 },
    testnet: true,
  },
  {
    id: 80002,
    hex: "0x13882",
    name: "Polygon Amoy",
    shortName: "Polygon",
    tokenStandard: "ERC-20",
    rpcUrl: "https://polygon-amoy-bor-rpc.publicnode.com",
    explorerUrl: "https://amoy.polygonscan.com",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    testnet: true,
  },
  {
    id: 84532,
    hex: "0x14a34",
    name: "Base Sepolia",
    shortName: "Base",
    tokenStandard: "ERC-20",
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    testnet: true,
  },
  {
    id: 46630,
    hex: "0xb626",
    name: "Robinhood Chain Testnet",
    shortName: "Robinhood",
    tokenStandard: "ERC-20",
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    testnet: true,
  },
];

export const SWAP_MAINNETS: SwapChain[] = [
  { id: 1, hex: "0x1", name: "Ethereum", shortName: "Ethereum", tokenStandard: "ERC-20", rpcUrl: "https://ethereum-rpc.publicnode.com", explorerUrl: "https://etherscan.io", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, testnet: false },
  { id: 56, hex: "0x38", name: "BNB Smart Chain", shortName: "BNB Chain", tokenStandard: "BEP-20", rpcUrl: "https://bsc-rpc.publicnode.com", explorerUrl: "https://bscscan.com", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, testnet: false },
  { id: 137, hex: "0x89", name: "Polygon", shortName: "Polygon", tokenStandard: "ERC-20", rpcUrl: "https://polygon-bor-rpc.publicnode.com", explorerUrl: "https://polygonscan.com", nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, testnet: false },
  { id: 8453, hex: "0x2105", name: "Base", shortName: "Base", tokenStandard: "ERC-20", rpcUrl: "https://mainnet.base.org", explorerUrl: "https://basescan.org", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, testnet: false },
  { id: 4663, hex: "0x1237", name: "Robinhood Chain", shortName: "Robinhood", tokenStandard: "ERC-20", rpcUrl: "https://rpc.mainnet.chain.robinhood.com", explorerUrl: "https://robinhoodchain.blockscout.com", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, testnet: false },
];

export function swapChainById(id: number): SwapChain | undefined {
  return [...SWAP_TESTNETS, ...SWAP_MAINNETS].find((c) => c.id === id);
}

export function explorerTx(chain: SwapChain, hash: string) {
  return `${chain.explorerUrl}/tx/${hash}`;
}

export function explorerAddress(chain: SwapChain, address: string) {
  return `${chain.explorerUrl}/address/${address}`;
}
