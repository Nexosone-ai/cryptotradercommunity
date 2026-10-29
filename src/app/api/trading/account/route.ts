import { and, eq } from "drizzle-orm";
import { readContext } from "@/lib/api";
import { builderFeeApprovals } from "@/lib/db/schema";
import { handler, json } from "@/lib/http";
import { hyperEvmBalances } from "@/lib/hyperliquid/evm";
import { activeAgent, listUserOrders } from "@/lib/trading/service";
import { bi } from "@/lib/i18n";

/** Account view: Hyperliquid state (source of truth) + platform permissions. */
export const GET = handler(async () => {
  const { db, hl, user, cfg } = await readContext();
  const agent = await activeAgent(db, user.id, hl.network);
  const [approval] = await db
    .select()
    .from(builderFeeApprovals)
    .where(and(eq(builderFeeApprovals.userId, user.id), eq(builderFeeApprovals.network, hl.network)))
    .limit(1);
  let state: unknown = null;
  let openOrders: unknown[] = [];
  let hlError: string | null = null;
  try {
    [state, openOrders] = await Promise.all([hl.clearinghouseState(user.walletAddress), hl.openOrders(user.walletAddress)]);
  } catch {
    hlError = bi("Couldn't load your Hyperliquid account information.", "Hyperliquid 계정 정보를 불러오지 못했습니다.");
  }
  // Where the user's USDC is: HyperEVM (not tradable yet) → Hyperliquid spot → perps (trading).
  const [spot, hyperEvm] = await Promise.all([
    hl
      .spotBalances(user.walletAddress)
      .then((b) => {
        const usdc = b.find((x) => x.coin === "USDC");
        return { usdcTotal: usdc?.total ?? "0", usdcHold: usdc?.hold ?? "0" };
      })
      .catch(() => null),
    hyperEvmBalances(hl.network, user.walletAddress).catch(() => null),
  ]);
  return json({
    network: hl.network,
    address: user.walletAddress,
    fetchedAt: new Date().toISOString(),
    hlError,
    state,
    spot,
    hyperEvm,
    openOrders,
    agent: agent ? { address: agent.agentAddress, validUntil: agent.validUntil, status: agent.status } : null,
    builder: {
      address: cfg.builderAddress,
      approvedMaxTenthsBp: approval?.maxFeeTenthsBp ?? null,
      verifiedAt: approval?.verifiedAt ?? null,
    },
    orders: await listUserOrders(db, user.id, 50),
  });
});
