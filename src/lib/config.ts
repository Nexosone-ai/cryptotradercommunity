import { getAddress, isAddress } from "viem";
import { DEFAULT_WALLET_CHAIN, WALLET_CHAINS } from "./chains";

/**
 * Server configuration. Every value has a safe default so a missing variable
 * disables the dependent feature instead of crashing the site.
 */

export type HlNetwork = "testnet" | "mainnet";

/** Hyperliquid's own cap for builder fees on perps: 0.1% = 100 tenths of a bp. */
export const HL_MAX_PERP_BUILDER_FEE_TENTHS_BP = 100;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function addressEnv(name: string): `0x${string}` | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  if (!isAddress(raw, { strict: false })) throw new Error(`${name} is not a valid address`);
  return getAddress(raw);
}

export function getConfig() {
  const network: HlNetwork = process.env.HL_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const appUrl = new URL(process.env.APP_URL || "http://localhost:3000");
  const platformMaxFee = intEnv(
    "PLATFORM_MAX_BUILDER_FEE_TENTHS_BP",
    50,
    0,
    HL_MAX_PERP_BUILDER_FEE_TENTHS_BP,
  );
  const walletChainId = intEnv("WALLET_CHAIN_ID", DEFAULT_WALLET_CHAIN[network], 1, Number.MAX_SAFE_INTEGER);
  if (!WALLET_CHAINS[walletChainId]) throw new Error(`WALLET_CHAIN_ID ${walletChainId} is not a supported wallet chain`);
  return {
    appUrl,
    /** EVM chain the wallet must be on for login and Hyperliquid approvals. */
    walletChain: WALLET_CHAINS[walletChainId],
    network,
    isMainnet: network === "mainnet",
    /** Mainnet orders need both the network and an explicit opt-in flag. */
    mainnetTradingEnabled: network === "mainnet" && process.env.MAINNET_TRADING_ENABLED === "true",
    builderAddress: addressEnv("BUILDER_ADDRESS"),
    adminWallet: addressEnv("ADMIN_WALLET_ADDRESS"),
    platformMaxFeeTenthsBp: platformMaxFee,
    manualOrderFeeTenthsBp: intEnv("MANUAL_ORDER_BUILDER_FEE_TENTHS_BP", 0, 0, platformMaxFee),
    maxManualOrderUsd: intEnv("MAX_MANUAL_ORDER_USD", 1000, 1, 10_000_000),
    agentKeyConfigured: /^[0-9a-fA-F]{64}$/.test(process.env.AGENT_KEY_ENCRYPTION_KEY ?? ""),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    /**
     * Bot execution engine (lib/engine). Off unless BOT_ENGINE_ENABLED=true, and testnet-only
     * for now: mainnet bot orders stay impossible until the engine has been audited.
     */
    botEngineEnabled: process.env.BOT_ENGINE_ENABLED === "true" && network === "testnet",
    /** Shared secret Vercel Cron sends as "Authorization: Bearer …" to /api/cron/*. */
    cronSecret: process.env.CRON_SECRET?.trim() || null,
    isProduction: process.env.NODE_ENV === "production",
  };
}

export type AppConfig = ReturnType<typeof getConfig>;

/** Public, non-secret subset that may be sent to the browser. */
export function getPublicConfig() {
  const c = getConfig();
  return {
    network: c.network,
    walletChain: c.walletChain,
    mainnetTradingEnabled: c.mainnetTradingEnabled,
    builderAddress: c.builderAddress,
    platformMaxFeeTenthsBp: c.platformMaxFeeTenthsBp,
    manualOrderFeeTenthsBp: c.manualOrderFeeTenthsBp,
    maxManualOrderUsd: c.maxManualOrderUsd,
    tradingAvailable: c.agentKeyConfigured && (c.network === "testnet" || c.mainnetTradingEnabled),
  };
}

export type PublicConfig = ReturnType<typeof getPublicConfig>;
