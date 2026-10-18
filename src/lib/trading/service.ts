import Decimal from "decimal.js";
import { and, desc, eq, gt } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import { getConfig, HL_MAX_PERP_BUILDER_FEE_TENTHS_BP, type AppConfig } from "../config";
import type { Db } from "../db/client";
import {
  agentAuthorizations,
  botSubscriptions,
  bots,
  builderFeeApprovals,
  orders,
  riskEvents,
  tradingAccounts,
} from "../db/schema";
import type { BotConfig } from "../bots/schema";
import { tenthsBpToPercentString } from "../fees/rates";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../http";
import { formatPerpPrice, formatPerpSize, newCloid } from "../hyperliquid/format";
import type { HlGateway } from "../hyperliquid/gateway";
import { decryptAgentKey, generateAgent } from "./agent-keys";

const AGENT_VALIDITY_DAYS = 30;
const MARKET_SLIPPAGE = new Decimal("0.05");

export async function ensureTradingAccount(
  db: Db,
  user: SessionUser,
  network: AppConfig["network"],
): Promise<typeof tradingAccounts.$inferSelect> {
  const [existing] = await db
    .select()
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, user.id), eq(tradingAccounts.network, network)))
    .limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(tradingAccounts)
    .values({ userId: user.id, network, hlAddress: user.walletAddress })
    .onConflictDoNothing()
    .returning();
  return row ?? (await ensureTradingAccount(db, user, network));
}

// ── Agent wallet authorization ────────────────────────────────────────────

/**
 * Step 1: the server creates an agent keypair and returns only its address.
 * The user then signs `approveAgent` with MetaMask in the browser.
 */
export async function prepareAgent(db: Db, user: SessionUser) {
  const cfg = getConfig();
  if (!cfg.agentKeyConfigured) {
    throw new ApiError(503, "AGENT_KEYS_DISABLED", "서버에 에이전트 키 암호화 설정이 없어 거래 권한 위임을 사용할 수 없습니다.");
  }
  // Superseded pending agents are discarded; Hyperliquid advises never reusing agent addresses.
  await db
    .update(agentAuthorizations)
    .set({ status: "REVOKED", revokedAt: new Date() })
    .where(and(eq(agentAuthorizations.userId, user.id), eq(agentAuthorizations.status, "PENDING")));
  const agent = generateAgent();
  const validUntil = new Date(Date.now() + AGENT_VALIDITY_DAYS * 86_400_000);
  const agentName = `ctc valid_until ${validUntil.getTime()}`;
  await db.insert(agentAuthorizations).values({
    userId: user.id,
    network: cfg.network,
    agentAddress: agent.address,
    agentName,
    encryptedKey: agent.encryptedKey,
    status: "PENDING",
    validUntil,
  });
  return {
    agentAddress: agent.address,
    agentName,
    validUntil: validUntil.toISOString(),
    network: cfg.network,
    hyperliquidChain: cfg.isMainnet ? "Mainnet" : "Testnet",
  };
}

/** Step 2: confirm on Hyperliquid (source of truth) that the agent is approved. */
export async function verifyAgent(db: Db, hl: HlGateway, user: SessionUser) {
  const [pending] = await db
    .select()
    .from(agentAuthorizations)
    .where(
      and(
        eq(agentAuthorizations.userId, user.id),
        eq(agentAuthorizations.network, hl.network),
        eq(agentAuthorizations.status, "PENDING"),
      ),
    )
    .orderBy(desc(agentAuthorizations.createdAt))
    .limit(1);
  if (!pending) throw notFound("승인 대기 중인 에이전트가 없습니다.");
  const agents = await hl.extraAgents(user.walletAddress);
  const found = agents.find((a) => a.address === pending.agentAddress);
  if (!found) throw conflict("AGENT_NOT_APPROVED", "Hyperliquid에서 에이전트 승인을 확인하지 못했습니다.");
  await db
    .update(agentAuthorizations)
    .set({ status: "REVOKED", revokedAt: new Date() })
    .where(and(eq(agentAuthorizations.userId, user.id), eq(agentAuthorizations.network, hl.network), eq(agentAuthorizations.status, "ACTIVE")));
  const [row] = await db
    .update(agentAuthorizations)
    .set({ status: "ACTIVE", verifiedAt: new Date() })
    .where(eq(agentAuthorizations.id, pending.id))
    .returning();
  await ensureTradingAccount(db, user, hl.network);
  return { agentAddress: row.agentAddress, validUntil: row.validUntil, status: row.status };
}

export async function revokeAgent(db: Db, user: SessionUser, network: AppConfig["network"]) {
  await db
    .update(agentAuthorizations)
    .set({ status: "REVOKED", revokedAt: new Date() })
    .where(and(eq(agentAuthorizations.userId, user.id), eq(agentAuthorizations.network, network)));
}

export async function activeAgent(db: Db, userId: string, network: AppConfig["network"]) {
  const [row] = await db
    .select()
    .from(agentAuthorizations)
    .where(
      and(
        eq(agentAuthorizations.userId, userId),
        eq(agentAuthorizations.network, network),
        eq(agentAuthorizations.status, "ACTIVE"),
        gt(agentAuthorizations.validUntil, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ── Builder fee approval ──────────────────────────────────────────────────

/** Parameters the user's main wallet must sign. The server picks builder + rate. */
export function builderApprovalChallenge(requiredTenthsBp: number) {
  const cfg = getConfig();
  if (!cfg.builderAddress) throw new ApiError(503, "BUILDER_NOT_CONFIGURED", "Builder 주소가 설정되지 않았습니다.");
  const rate = Math.min(Math.max(requiredTenthsBp, 0), cfg.platformMaxFeeTenthsBp, HL_MAX_PERP_BUILDER_FEE_TENTHS_BP);
  return {
    builder: cfg.builderAddress,
    maxFeeRate: tenthsBpToPercentString(rate),
    maxFeeTenthsBp: rate,
    hyperliquidChain: cfg.isMainnet ? ("Mainnet" as const) : ("Testnet" as const),
    network: cfg.network,
  };
}

/** Reads the approval from Hyperliquid and caches it with a verification time. */
export async function refreshBuilderApproval(db: Db, hl: HlGateway, user: SessionUser) {
  const builder = getConfig().builderAddress;
  if (!builder) return { builder: null, maxFeeTenthsBp: 0 };
  const max = await hl.maxBuilderFee(user.walletAddress, builder);
  await db
    .insert(builderFeeApprovals)
    .values({ userId: user.id, network: hl.network, builderAddress: builder.toLowerCase(), maxFeeTenthsBp: max, verifiedAt: new Date() })
    .onConflictDoUpdate({
      target: [builderFeeApprovals.userId, builderFeeApprovals.network, builderFeeApprovals.builderAddress],
      set: { maxFeeTenthsBp: max, verifiedAt: new Date() },
    });
  return { builder, maxFeeTenthsBp: max };
}

// ── Order gate ────────────────────────────────────────────────────────────

export interface OrderRequest {
  coin: string;
  isBuy: boolean;
  size: string;
  orderType: "MARKET" | "LIMIT";
  price?: string;
  tif?: "Gtc" | "Ioc" | "Alo";
  reduceOnly?: boolean;
  /** Required on mainnet: the user re-confirmed live trading in the UI. */
  confirmMainnet?: boolean;
}

export interface OrderContext {
  source: "MANUAL" | "BOT";
  botId?: string;
}

async function reject(db: Db, user: SessionUser, botId: string | undefined, code: string, message: string, status = 403): Promise<never> {
  await db.insert(riskEvents).values({ userId: user.id, botId: botId ?? null, kind: `ORDER_REJECTED:${code}`, severity: "INFO", detail: { message } });
  throw new ApiError(status, code, message);
}

/**
 * Server-side order gate. Every platform order passes here; anything outside
 * the user's approvals or limits is refused before it reaches Hyperliquid.
 * Fail-closed: if Hyperliquid cannot confirm the builder approval, no order.
 */
export async function placeOrder(db: Db, hl: HlGateway, user: SessionUser, req: OrderRequest, ctx: OrderContext) {
  const cfg = getConfig();
  if (hl.network !== cfg.network) throw forbidden("네트워크 설정이 일치하지 않습니다.");
  if (cfg.isMainnet) {
    if (!cfg.mainnetTradingEnabled) await reject(db, user, ctx.botId, "MAINNET_DISABLED", "메인넷 거래가 활성화되지 않았습니다.");
    if (req.confirmMainnet !== true) await reject(db, user, ctx.botId, "MAINNET_CONFIRM_REQUIRED", "메인넷 실거래 재확인이 필요합니다.");
  }

  // 1. Fee and limits come from the bot subscription (bot orders) or platform config (manual).
  let feeTenthsBp = cfg.manualOrderFeeTenthsBp;
  let maxOrderUsd = new Decimal(cfg.maxManualOrderUsd);
  let subscriptionId: string | null = null;
  if (ctx.source === "BOT") {
    if (!ctx.botId) throw badRequest("BOT_REQUIRED", "봇 주문에는 botId가 필요합니다.");
    const [bot] = await db.select().from(bots).where(eq(bots.id, ctx.botId)).limit(1);
    if (!bot || bot.status !== "LIVE") await reject(db, user, ctx.botId, "BOT_NOT_LIVE", "봇이 실행 상태가 아닙니다.");
    const [sub] = await db
      .select()
      .from(botSubscriptions)
      .where(and(eq(botSubscriptions.botId, ctx.botId), eq(botSubscriptions.userId, user.id), eq(botSubscriptions.network, hl.network)))
      .limit(1);
    if (!sub || sub.status !== "ACTIVE") {
      await reject(db, user, ctx.botId, "SUBSCRIPTION_INACTIVE", "봇 구독이 중지되었거나 재동의가 필요합니다.");
    }
    const botConfig = bot!.config as BotConfig;
    if (!botConfig.markets.includes(`${req.coin}-PERP`)) {
      await reject(db, user, ctx.botId, "MARKET_NOT_ALLOWED", "봇에 허용되지 않은 마켓입니다.");
    }
    feeTenthsBp = sub!.acceptedFeeTenthsBp; // never the bot's current fee
    maxOrderUsd = new Decimal(botConfig.risk.maxOrderUsd);
    subscriptionId = sub!.id;
  }
  if (feeTenthsBp > cfg.platformMaxFeeTenthsBp || feeTenthsBp > HL_MAX_PERP_BUILDER_FEE_TENTHS_BP) {
    await reject(db, user, ctx.botId, "FEE_ABOVE_CAP", "수수료율이 허용 상한을 초과합니다.");
  }

  // 2. Agent authorization (trading permission) must be active and unexpired.
  const agent = await activeAgent(db, user.id, hl.network);
  if (!agent) await reject(db, user, ctx.botId, "AGENT_NOT_AUTHORIZED", "거래 권한(에이전트) 승인이 필요합니다.");

  // 3. Builder fee approval, checked live on Hyperliquid.
  if (feeTenthsBp > 0) {
    if (!cfg.builderAddress) await reject(db, user, ctx.botId, "BUILDER_NOT_CONFIGURED", "Builder 주소가 설정되지 않았습니다.", 503);
    let approved: number;
    try {
      approved = await hl.maxBuilderFee(user.walletAddress, cfg.builderAddress!);
    } catch {
      return reject(db, user, ctx.botId, "HL_UNAVAILABLE", "Hyperliquid에서 수수료 승인을 확인할 수 없어 주문을 중단했습니다.", 503);
    }
    if (approved < feeTenthsBp) {
      await reject(db, user, ctx.botId, "BUILDER_FEE_NOT_APPROVED", `Builder Fee 승인(${approved}) 이 필요한 수수료(${feeTenthsBp})보다 낮습니다.`);
    }
  }

  // 4. Market, price, size and notional limits.
  const assets = await hl.perpAssets();
  const asset = assets.find((a) => a.name === req.coin);
  if (!asset) throw badRequest("UNKNOWN_MARKET", "지원하지 않는 마켓입니다.");
  let size: Decimal;
  try {
    size = new Decimal(req.size);
  } catch {
    throw badRequest("INVALID_SIZE", "주문 수량이 올바르지 않습니다.");
  }
  if (!size.isFinite() || size.lte(0)) throw badRequest("INVALID_SIZE", "주문 수량이 올바르지 않습니다.");
  const mids = await hl.mids();
  const mid = mids[req.coin] ? new Decimal(mids[req.coin]) : null;
  if (!mid) throw new ApiError(503, "NO_PRICE", "현재가를 확인할 수 없습니다.");

  let price: Decimal;
  let tif: "Gtc" | "Ioc" | "Alo";
  if (req.orderType === "MARKET") {
    price = req.isBuy ? mid.mul(MARKET_SLIPPAGE.plus(1)) : mid.mul(new Decimal(1).minus(MARKET_SLIPPAGE));
    tif = "Ioc";
  } else {
    if (!req.price) throw badRequest("PRICE_REQUIRED", "지정가 주문에는 가격이 필요합니다.");
    price = new Decimal(req.price);
    if (!price.isFinite() || price.lte(0)) throw badRequest("INVALID_PRICE", "가격이 올바르지 않습니다.");
    // Fat-finger guard: limit price within ±20% of mid.
    if (price.minus(mid).abs().div(mid).gt(0.2)) {
      await reject(db, user, ctx.botId, "PRICE_OUT_OF_BAND", "지정가가 현재가 대비 ±20% 범위를 벗어났습니다.", 400);
    }
    tif = req.tif ?? "Gtc";
  }
  const px = formatPerpPrice(price, asset.szDecimals);
  const sz = formatPerpSize(size, asset.szDecimals);
  const notional = new Decimal(sz).mul(mid);
  if (notional.gt(maxOrderUsd) && !req.reduceOnly) {
    await reject(db, user, ctx.botId, "ORDER_TOO_LARGE", `주문 금액이 1회 한도(${maxOrderUsd.toFixed()} USDC)를 초과합니다.`, 400);
  }
  if (notional.lt(10)) throw badRequest("ORDER_TOO_SMALL", "Hyperliquid 최소 주문 금액(10 USDC) 미만입니다.");

  // 5. Record intent first (unique cloid), then send.
  const cloid = newCloid();
  const [order] = await db
    .insert(orders)
    .values({
      userId: user.id,
      botId: ctx.botId ?? null,
      subscriptionId,
      source: ctx.source,
      network: hl.network,
      hlAddress: user.walletAddress,
      cloid,
      coin: req.coin,
      side: req.isBuy ? "BUY" : "SELL",
      orderType: req.orderType,
      price: px,
      size: sz,
      reduceOnly: Boolean(req.reduceOnly),
      builderFeeTenthsBp: feeTenthsBp,
      status: "PENDING",
    })
    .returning();

  try {
    const agentKey = decryptAgentKey(agent!.encryptedKey, agent!.agentAddress);
    const [status] = await hl.placeOrders(
      agentKey,
      [{ a: asset.index, b: req.isBuy, p: px, s: sz, r: Boolean(req.reduceOnly), t: { limit: { tif } }, c: cloid }],
      feeTenthsBp > 0 ? { b: cfg.builderAddress!.toLowerCase() as `0x${string}`, f: feeTenthsBp } : undefined,
    );
    const update = interpretStatus(status);
    const [saved] = await db.update(orders).set({ ...update, updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
    return saved;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [saved] = await db
      .update(orders)
      .set({ status: "ERROR", error: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .returning();
    await db.insert(riskEvents).values({ userId: user.id, botId: ctx.botId ?? null, kind: "ORDER_SEND_FAILED", severity: "WARN", detail: { orderId: order.id, message } });
    return saved;
  }
}

function interpretStatus(status: unknown): Partial<typeof orders.$inferInsert> {
  if (status && typeof status === "object") {
    if ("resting" in status) return { status: "RESTING", hlOrderId: (status as { resting: { oid: number } }).resting.oid };
    if ("filled" in status) return { status: "FILLED", hlOrderId: (status as { filled: { oid: number } }).filled.oid };
    if ("error" in status) return { status: "REJECTED", error: String((status as { error: string }).error) };
  }
  return { status: "ERROR", error: `Unexpected status: ${JSON.stringify(status)}` };
}

export async function cancelOrder(db: Db, hl: HlGateway, user: SessionUser, orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.userId !== user.id) throw notFound("주문을 찾을 수 없습니다.");
  if (order.status !== "RESTING") throw conflict("NOT_CANCELABLE", "미체결 주문만 취소할 수 있습니다.");
  const agent = await activeAgent(db, user.id, hl.network);
  if (!agent) throw forbidden("거래 권한(에이전트) 승인이 필요합니다.");
  const asset = (await hl.perpAssets()).find((a) => a.name === order.coin);
  if (!asset) throw badRequest("UNKNOWN_MARKET", "마켓 정보를 찾을 수 없습니다.");
  await hl.cancelByCloid(decryptAgentKey(agent.encryptedKey, agent.agentAddress), asset.index, order.cloid as `0x${string}`);
  const [saved] = await db.update(orders).set({ status: "CANCELED", updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
  return saved;
}

export async function listUserOrders(db: Db, userId: string, limit = 50) {
  return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)).limit(limit);
}
