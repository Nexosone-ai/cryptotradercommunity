import type { HlFill, HlGateway, HlOrderWire } from "@/lib/hyperliquid/gateway";

/** In-memory Hyperliquid stand-in for tests. Records every exchange call. */
export function fakeHl(overrides: Partial<HlGateway> = {}) {
  const calls: { orders: HlOrderWire[]; builder?: { b: string; f: number }; agentKey: string }[] = [];
  const approvals = new Map<string, number>();
  const agents = new Map<string, { address: string; name: string; validUntil: number | null }[]>();
  let nextOid = 1000;
  const gw: HlGateway & {
    calls: typeof calls;
    setApproval(user: string, tenthsBp: number): void;
    addAgent(user: string, address: string): void;
  } = {
    network: "testnet",
    calls,
    setApproval: (user, v) => approvals.set(user.toLowerCase(), v),
    addAgent: (user, address) =>
      agents.set(user.toLowerCase(), [...(agents.get(user.toLowerCase()) ?? []), { address: address.toLowerCase(), name: "ctc", validUntil: null }]),
    perpAssets: async () => [
      { index: 0, name: "BTC", szDecimals: 5, maxLeverage: 40 },
      { index: 1, name: "ETH", szDecimals: 4, maxLeverage: 25 },
    ],
    mids: async () => ({ BTC: "80000", ETH: "2400" }),
    maxBuilderFee: async (user) => approvals.get(user.toLowerCase()) ?? 0,
    extraAgents: async (user) => agents.get(user.toLowerCase()) ?? [],
    userFillsByTime: async () => [] as HlFill[],
    builderRewards: async () => ({ builderRewards: "0", unclaimedRewards: "0", claimedRewards: "0" }),
    placeOrders: async (agentKey, orders, builder) => {
      calls.push({ orders, builder, agentKey });
      return orders.map(() => ({ resting: { oid: nextOid++ } }));
    },
    cancelByCloid: async () => {},
    updateLeverage: async () => {},
    clearinghouseState: async () => ({ marginSummary: { accountValue: "0" }, assetPositions: [] }),
    openOrders: async () => [],
    spotBalances: async () => [],
    accountMode: async () => "default" as const,
    userFills: async () => [],
    candles: async () => [],
    marketOverview: async () => [],
    ...overrides,
  };
  return gw;
}
