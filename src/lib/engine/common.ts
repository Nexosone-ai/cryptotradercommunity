import Decimal from "decimal.js";
import { and, eq, gte } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { orders } from "../db/schema";
import type { HlGateway } from "../hyperliquid/gateway";
import { localize } from "../i18n";
import { decryptAgentKey } from "../trading/agent-keys";
import { activeAgent } from "../trading/service";

/** Helpers shared by the signal engine (execute.ts) and copy trading (copy.ts). */

/** What the engine did for one subscriber on one signal. */
export type Outcome = { status: "DONE" | "SKIPPED" | "FAILED"; reason: string; orderIds: string[] };

export const message =(err: unknown) => localize(err instanceof Error ? err.message : String(err), "en");

/** Signed position size for a coin on Hyperliquid (0 when flat). */
export async function positionSize(hl: HlGateway, wallet: string, coin: string): Promise<Decimal> {
  const state = (await hl.clearinghouseState(wallet)) as { assetPositions?: { position: { coin: string; szi: string } }[] };
  const p = state.assetPositions?.find((a) => a.position.coin === coin);
  return p ? new Decimal(p.position.szi) : new Decimal(0);
}

export async function cancelStop(db: Db, hl: HlGateway, user: SessionUser, coin: string, cloid: string) {
  try {
    const agent = await activeAgent(db, user.id, hl.network);
    const asset = (await hl.perpAssets()).find((a) => a.name === coin);
    if (agent && asset) await hl.cancelByCloid(decryptAgentKey(agent.encryptedKey, agent.agentAddress), asset.index, cloid as `0x${string}`);
    await db.update(orders).set({ status: "CANCELED", updatedAt: new Date() }).where(eq(orders.cloid, cloid));
  } catch {
    // Hyperliquid drops reduce-only stops once there is nothing left to reduce.
  }
}

/** Realized PnL minus fees today (UTC) from fills of this subscription's bot orders. */
export async function realizedPnlToday(db: Db, hl: HlGateway, wallet: string, subscriptionId: string): Promise<Decimal> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const mine = await db
    .select({ cloid: orders.cloid })
    .from(orders)
    .where(and(eq(orders.subscriptionId, subscriptionId), gte(orders.createdAt, new Date(dayStart.getTime() - 7 * 86_400_000))));
  if (mine.length === 0) return new Decimal(0);
  const cloids = new Set(mine.map((o) => o.cloid.toLowerCase()));
  const fills = await hl.userFillsByTime(wallet, dayStart.getTime());
  return fills
    .filter((f) => f.cloid && cloids.has(f.cloid.toLowerCase()))
    .reduce((sum, f) => sum.plus(f.closedPnl).minus(f.fee), new Decimal(0));
}
