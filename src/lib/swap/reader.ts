import "server-only";
import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import artifact from "./artifact.json";
import { enabledSwapChain } from "./config";
import { ORDER_TYPES, swapDomain, type SwapOrder } from "./order";

export const SWAP_ABI = artifact.abi as typeof artifact.abi;

export interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
}

export interface OnChainOrderState {
  filledBuyAmount: bigint;
  cancelled: boolean;
  minNonce: bigint;
}

export interface FillLog {
  orderHash: Hex;
  maker: Address;
  taker: Address;
  sellAmountFilled: bigint;
  buyAmountFilled: bigint;
  logIndex: number;
  blockNumber: bigint;
}

/** Read-only chain access for the swap module (injectable for tests). */
export interface SwapChainReader {
  tokenMetadata(chainId: number, token: Address): Promise<TokenMetadata>;
  deploymentFromTx(chainId: number, txHash: Hex): Promise<{ contractAddress: Address; deployer: Address; code: Hex }>;
  verifyOrderSignature(chainId: number, contract: Address, order: SwapOrder, signature: Hex): Promise<boolean>;
  orderState(chainId: number, contract: Address, order: SwapOrder, orderHash: Hex): Promise<OnChainOrderState>;
  balanceAndAllowance(chainId: number, token: Address, owner: Address, spender: Address): Promise<{ balance: bigint; allowance: bigint }>;
  fillLogs(chainId: number, contract: Address, txHash: Hex): Promise<FillLog[]>;
  now(): number;
}

/** Zeroes immutable byte ranges so per-deployment values don't affect comparison. */
export function maskImmutables(code: Hex): Hex {
  const bytes = Buffer.from(code.slice(2), "hex");
  for (const r of artifact.immutableRanges) {
    if (r.start + r.length <= bytes.length) bytes.fill(0, r.start, r.start + r.length);
  }
  return `0x${bytes.toString("hex")}`;
}

/** Runtime code matches the audited artifact (immutables masked). */
export function isExpectedSwapCode(code: Hex): { ok: boolean; codeHash: Hex } {
  if (code.length !== artifact.deployedBytecode.length) return { ok: false, codeHash: keccak256(code) };
  const masked = maskImmutables(code);
  const expected = maskImmutables(artifact.deployedBytecode as Hex);
  return { ok: masked.toLowerCase() === expected.toLowerCase(), codeHash: keccak256(masked) };
}

const clients = new Map<number, PublicClient>();

function client(chainId: number): PublicClient {
  const chain = enabledSwapChain(chainId);
  if (!chain) throw new Error(`Swap chain ${chainId} is not enabled`);
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({ transport: http(chain.rpcUrl, { timeout: 15_000, retryCount: 2 }) }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

export function createSwapReader(): SwapChainReader {
  return {
    async tokenMetadata(chainId, token) {
      const c = client(chainId);
      const [symbol, name, decimals] = await Promise.all([
        c.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
        c.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
        c.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      ]);
      return { symbol: String(symbol).slice(0, 32), name: String(name).slice(0, 64), decimals: Number(decimals) };
    },
    async deploymentFromTx(chainId, txHash) {
      const c = client(chainId);
      const receipt = await c.getTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment transaction failed or created no contract");
      const code = await c.getCode({ address: receipt.contractAddress });
      if (!code) throw new Error("No code at deployed address");
      return { contractAddress: getAddress(receipt.contractAddress), deployer: getAddress(receipt.from), code };
    },
    async verifyOrderSignature(chainId, contract, order, signature) {
      // Handles EOAs and smart-contract wallets (EIP-1271), like the contract does.
      return client(chainId).verifyTypedData({
        address: order.maker,
        domain: swapDomain(chainId, contract),
        types: ORDER_TYPES,
        primaryType: "Order",
        message: order,
        signature,
      });
    },
    async orderState(chainId, contract, order, orderHash) {
      const c = client(chainId);
      const [filledBuyAmount, cancelled, minNonce] = await Promise.all([
        c.readContract({ address: contract, abi: SWAP_ABI, functionName: "filledBuyAmount", args: [orderHash] }),
        c.readContract({ address: contract, abi: SWAP_ABI, functionName: "cancelled", args: [orderHash] }),
        c.readContract({ address: contract, abi: SWAP_ABI, functionName: "minNonce", args: [order.maker] }),
      ]);
      return { filledBuyAmount: filledBuyAmount as bigint, cancelled: cancelled as boolean, minNonce: minNonce as bigint };
    },
    async balanceAndAllowance(chainId, token, owner, spender) {
      const c = client(chainId);
      const [balance, allowance] = await Promise.all([
        c.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
        c.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
      ]);
      return { balance, allowance };
    },
    async fillLogs(chainId, contract, txHash) {
      const receipt = await client(chainId).getTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") return [];
      const out: FillLog[] = [];
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== contract.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: SWAP_ABI, data: log.data, topics: log.topics });
          if (ev.eventName !== "OrderFilled") continue;
          const a = ev.args as unknown as {
            orderHash: Hex;
            maker: Address;
            taker: Address;
            sellAmountFilled: bigint;
            buyAmountFilled: bigint;
          };
          out.push({ ...a, logIndex: log.logIndex, blockNumber: receipt.blockNumber });
        } catch {
          // not an event of ours
        }
      }
      return out;
    },
    now: () => Math.floor(Date.now() / 1000),
  };
}

let shared: SwapChainReader | undefined;
export function getSwapReader(): SwapChainReader {
  return (shared ??= createSwapReader());
}
