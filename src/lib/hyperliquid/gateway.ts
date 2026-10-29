import "server-only";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import type { HlNetwork } from "../config";
import type { AccountMode } from "./balance";

/**
 * Thin, injectable wrapper over the Hyperliquid Info/Exchange APIs.
 * Hyperliquid is the source of truth for balances, orders and fills.
 */

export interface PerpAsset {
  index: number;
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

export interface HlOrderWire {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
  t: { limit: { tif: "Gtc" | "Ioc" | "Alo" } } | { trigger: { isMarket: boolean; triggerPx: string; tpsl: "tp" | "sl" } };
  c: `0x${string}`;
}

export type HlOrderStatus =
  | { resting: { oid: number } }
  | { filled: { oid: number; totalSz: string; avgPx: string } }
  | { error: string }
  | string;

export interface HlFill {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  time: number;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  builderFee?: string;
  tid: number;
  feeToken: string;
  cloid?: string | null;
}

export interface HlGateway {
  network: HlNetwork;
  perpAssets(): Promise<PerpAsset[]>;
  mids(): Promise<Record<string, string>>;
  maxBuilderFee(user: string, builder: string): Promise<number>;
  extraAgents(user: string): Promise<{ address: string; name: string; validUntil: number | null }[]>;
  userFillsByTime(user: string, startTime: number): Promise<HlFill[]>;
  builderRewards(builder: string): Promise<{ builderRewards: string; unclaimedRewards: string; claimedRewards: string }>;
  /** Read-only views (Hyperliquid is the source of truth). */
  clearinghouseState(user: string): Promise<unknown>;
  /** HyperCore spot balances (USDC sits here before it is moved to perps). */
  spotBalances(user: string): Promise<{ coin: string; total: string; hold: string }[]>;
  /** Standard ("default"), unifiedAccount, portfolioMargin or disabled. */
  accountMode(user: string): Promise<AccountMode>;
  openOrders(user: string): Promise<unknown[]>;
  userFills(user: string): Promise<HlFill[]>;
  candles(coin: string, interval: string, startTime: number): Promise<unknown[]>;
  marketOverview(): Promise<{ name: string; szDecimals: number; maxLeverage: number; markPx: string; funding: string; openInterest: string; dayNtlVlm: string; prevDayPx: string }[]>;
  placeOrders(agentKey: `0x${string}`, orders: HlOrderWire[], builder?: { b: `0x${string}`; f: number }): Promise<HlOrderStatus[]>;
  cancelByCloid(agentKey: `0x${string}`, asset: number, cloid: `0x${string}`): Promise<void>;
  /** Sets cross leverage for an asset (agent-signed). */
  updateLeverage(agentKey: `0x${string}`, asset: number, leverage: number): Promise<void>;
}

const META_TTL_MS = 60_000;

export function createHlGateway(network: HlNetwork): HlGateway {
  const transport = new HttpTransport({ isTestnet: network === "testnet", timeout: 10_000 });
  const info = new InfoClient({ transport });
  let metaCache: { at: number; assets: PerpAsset[] } | null = null;

  const exchangeFor = (agentKey: `0x${string}`) =>
    new ExchangeClient({ transport, wallet: privateKeyToAccount(agentKey) });

  return {
    network,
    async perpAssets() {
      if (metaCache && Date.now() - metaCache.at < META_TTL_MS) return metaCache.assets;
      const meta = await info.meta();
      const assets = meta.universe
        .map((u, index) => ({ u, index }))
        .filter(({ u }) => !u.isDelisted)
        .map(({ u, index }) => ({ index, name: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage }));
      metaCache = { at: Date.now(), assets };
      return assets;
    },
    mids: () => info.allMids() as Promise<Record<string, string>>,
    maxBuilderFee: (user, builder) =>
      info.maxBuilderFee({ user: user as `0x${string}`, builder: builder as `0x${string}` }),
    async extraAgents(user) {
      const rows = await info.extraAgents({ user: user as `0x${string}` });
      return rows.map((r) => ({ address: r.address.toLowerCase(), name: r.name, validUntil: r.validUntil }));
    },
    async userFillsByTime(user, startTime) {
      const rows = await info.userFillsByTime({ user: user as `0x${string}`, startTime, aggregateByTime: false });
      return rows as unknown as HlFill[];
    },
    async builderRewards(builder) {
      const r = await info.referral({ user: builder as `0x${string}` });
      return { builderRewards: r.builderRewards, unclaimedRewards: r.unclaimedRewards, claimedRewards: r.claimedRewards };
    },
    clearinghouseState: (user) => info.clearinghouseState({ user: user as `0x${string}` }),
    accountMode: (user) => info.userAbstraction({ user: user as `0x${string}` }),
    async spotBalances(user) {
      const s = await info.spotClearinghouseState({ user: user as `0x${string}` });
      return s.balances.map((b) => ({ coin: b.coin, total: b.total, hold: b.hold }));
    },
    openOrders: (user) => info.frontendOpenOrders({ user: user as `0x${string}` }) as Promise<unknown[]>,
    userFills: async (user) => (await info.userFills({ user: user as `0x${string}` })) as unknown as HlFill[],
    candles: (coin, interval, startTime) =>
      info.candleSnapshot({ coin, interval: interval as "1h", startTime }) as Promise<unknown[]>,
    async marketOverview() {
      const [meta, ctxs] = await info.metaAndAssetCtxs();
      return meta.universe
        .map((u, i) => ({ u, c: ctxs[i] }))
        .filter(({ u, c }) => c && !u.isDelisted)
        .map(({ u, c }) => ({
          name: u.name,
          szDecimals: u.szDecimals,
          maxLeverage: u.maxLeverage,
          markPx: c.markPx,
          funding: c.funding,
          openInterest: c.openInterest,
          dayNtlVlm: c.dayNtlVlm,
          prevDayPx: c.prevDayPx,
        }));
    },
    async placeOrders(agentKey, orders, builder) {
      const res = await exchangeFor(agentKey).order({ orders, grouping: "na", ...(builder ? { builder } : {}) });
      return res.response.data.statuses as HlOrderStatus[];
    },
    async cancelByCloid(agentKey, asset, cloid) {
      await exchangeFor(agentKey).cancelByCloid({ cancels: [{ asset, cloid }] });
    },
    async updateLeverage(agentKey, asset, leverage) {
      await exchangeFor(agentKey).updateLeverage({ asset, isCross: true, leverage });
    },
  };
}

const globalForHl = globalThis as unknown as { __ctcHl?: Partial<Record<HlNetwork, HlGateway>> };

export function getHlGateway(network: HlNetwork): HlGateway {
  globalForHl.__ctcHl ??= {};
  return (globalForHl.__ctcHl[network] ??= createHlGateway(network));
}
