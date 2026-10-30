import Decimal from "decimal.js";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
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
import { HlRejectedError } from "../hyperliquid/errors";
import type { HlGateway, HlOrderLookup } from "../hyperliquid/gateway";
import { decryptAgentKey, generateAgent } from "./agent-keys";
import { bi } from "../i18n";

const AGENT_VALIDITY_DAYS = 30;
const MARKET_SLIPPAGE = new Decimal("0.05");
/** Worst fill price allowed once a stop-market order triggers. */
const STOP_SLIPPAGE = new Decimal("0.1");

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
    throw new ApiError(503, "AGENT_KEYS_DISABLED", bi("Trading permission can't be delegated because agent key encryption isn't configured on the server.", "서버에 에이전트 키 암호화 설정이 없어 거래 권한 위임을 사용할 수 없습니다."));
  }
  // View-only mainnet: no trading permission is handed out until mainnet trading is enabled.
  if (cfg.isMainnet && !cfg.mainnetTradingEnabled) {
    throw new ApiError(403, "MAINNET_DISABLED", bi("Mainnet trading isn't enabled, so trading permission can't be delegated.", "메인넷 거래가 활성화되지 않아 거래 권한을 위임할 수 없습니다."));
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
  if (!pending) throw notFound(bi("No agent wallet is awaiting approval.", "승인 대기 중인 에이전트가 없습니다."));
  const agents = await hl.extraAgents(user.walletAddress);
  const found = agents.find((a) => a.address === pending.agentAddress);
  if (!found) throw conflict("AGENT_NOT_APPROVED", bi("Couldn't confirm the agent wallet approval on Hyperliquid.", "Hyperliquid에서 에이전트 승인을 확인하지 못했습니다."));
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
  if (!cfg.builderAddress) throw new ApiError(503, "BUILDER_NOT_CONFIGURED", bi("The Builder address isn't configured.", "Builder 주소가 설정되지 않았습니다."));
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
  /** STOP_MARKET is a reduce-only stop loss that rests on Hyperliquid until triggerPrice. */
  orderType: "MARKET" | "LIMIT" | "STOP_MARKET";
  price?: string;
  triggerPrice?: string;
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
  if (hl.network !== cfg.network) throw forbidden(bi("Network settings don't match.", "네트워크 설정이 일치하지 않습니다."));
  if (cfg.isMainnet) {
    if (!cfg.mainnetTradingEnabled) await reject(db, user, ctx.botId, "MAINNET_DISABLED", bi("Mainnet trading isn't enabled.", "메인넷 거래가 활성화되지 않았습니다."));
    if (req.confirmMainnet !== true) await reject(db, user, ctx.botId, "MAINNET_CONFIRM_REQUIRED", bi("Please reconfirm that you want to place a real mainnet trade.", "메인넷 실거래 재확인이 필요합니다."));
  }

  // 1. Fee and limits come from the bot subscription (bot orders) or platform config (manual).
  let feeTenthsBp = cfg.manualOrderFeeTenthsBp;
  let maxOrderUsd = new Decimal(cfg.maxManualOrderUsd);
  let subscriptionId: string | null = null;
  if (ctx.source === "BOT") {
    if (!ctx.botId) throw badRequest("BOT_REQUIRED", bi("Bot orders require a botId.", "봇 주문에는 botId가 필요합니다."));
    const [bot] = await db.select().from(bots).where(eq(bots.id, ctx.botId)).limit(1);
    if (!bot || bot.status !== "LIVE") await reject(db, user, ctx.botId, "BOT_NOT_LIVE", bi("The bot isn't running.", "봇이 실행 상태가 아닙니다."));
    const [sub] = await db
      .select()
      .from(botSubscriptions)
      .where(and(eq(botSubscriptions.botId, ctx.botId), eq(botSubscriptions.userId, user.id), eq(botSubscriptions.network, hl.network)))
      .limit(1);
    if (!sub || sub.status !== "ACTIVE") {
      await reject(db, user, ctx.botId, "SUBSCRIPTION_INACTIVE", bi("The bot subscription is stopped or needs re-consent.", "봇 구독이 중지되었거나 재동의가 필요합니다."));
    }
    const botConfig = bot!.config as BotConfig;
    if (!botConfig.markets.includes(`${req.coin}-PERP`)) {
      await reject(db, user, ctx.botId, "MARKET_NOT_ALLOWED", bi("This market isn't allowed for the bot.", "봇에 허용되지 않은 마켓입니다."));
    }
    feeTenthsBp = sub!.acceptedFeeTenthsBp; // never the bot's current fee
    maxOrderUsd = new Decimal(botConfig.risk.maxOrderUsd);
    subscriptionId = sub!.id;
  }
  if (feeTenthsBp > cfg.platformMaxFeeTenthsBp || feeTenthsBp > HL_MAX_PERP_BUILDER_FEE_TENTHS_BP) {
    await reject(db, user, ctx.botId, "FEE_ABOVE_CAP", bi("The fee rate exceeds the allowed cap.", "수수료율이 허용 상한을 초과합니다."));
  }

  // 2. Agent authorization (trading permission) must be active and unexpired.
  const agent = await activeAgent(db, user.id, hl.network);
  if (!agent) await reject(db, user, ctx.botId, "AGENT_NOT_AUTHORIZED", bi("You need to approve trading permission (agent wallet).", "거래 권한(에이전트) 승인이 필요합니다."));

  // 3. Builder fee approval, checked live on Hyperliquid.
  if (feeTenthsBp > 0) {
    if (!cfg.builderAddress) await reject(db, user, ctx.botId, "BUILDER_NOT_CONFIGURED", bi("The Builder address isn't configured.", "Builder 주소가 설정되지 않았습니다."), 503);
    let approved: number;
    try {
      approved = await hl.maxBuilderFee(user.walletAddress, cfg.builderAddress!);
    } catch {
      return reject(db, user, ctx.botId, "HL_UNAVAILABLE", bi("The order was stopped because the fee approval couldn't be confirmed on Hyperliquid.", "Hyperliquid에서 수수료 승인을 확인할 수 없어 주문을 중단했습니다."), 503);
    }
    if (approved < feeTenthsBp) {
      await reject(db, user, ctx.botId, "BUILDER_FEE_NOT_APPROVED", bi(`Your Builder Fee approval (${approved}) is lower than the required fee (${feeTenthsBp}).`, `Builder Fee 승인(${approved}) 이 필요한 수수료(${feeTenthsBp})보다 낮습니다.`));
    }
  }

  // 4. Market, price, size and notional limits.
  const assets = await hl.perpAssets();
  const asset = assets.find((a) => a.name === req.coin);
  if (!asset) throw badRequest("UNKNOWN_MARKET", bi("Unsupported market.", "지원하지 않는 마켓입니다."));
  let size: Decimal;
  try {
    size = new Decimal(req.size);
  } catch {
    throw badRequest("INVALID_SIZE", bi("The order size is invalid.", "주문 수량이 올바르지 않습니다."));
  }
  if (!size.isFinite() || size.lte(0)) throw badRequest("INVALID_SIZE", bi("The order size is invalid.", "주문 수량이 올바르지 않습니다."));
  const mids = await hl.mids();
  const mid = mids[req.coin] ? new Decimal(mids[req.coin]) : null;
  if (!mid) throw new ApiError(503, "NO_PRICE", bi("Couldn't get the current price.", "현재가를 확인할 수 없습니다."));

  let price: Decimal;
  let tif: "Gtc" | "Ioc" | "Alo" = "Gtc";
  let trigger: Decimal | null = null;
  if (req.orderType === "MARKET") {
    price = req.isBuy ? mid.mul(MARKET_SLIPPAGE.plus(1)) : mid.mul(new Decimal(1).minus(MARKET_SLIPPAGE));
    tif = "Ioc";
  } else if (req.orderType === "STOP_MARKET") {
    // Stops only ever close a position.
    if (!req.reduceOnly) throw badRequest("STOP_MUST_REDUCE", bi("Stop orders must be reduce-only.", "스탑 주문은 포지션 축소 전용이어야 합니다."));
    try {
      trigger = new Decimal(req.triggerPrice ?? "");
    } catch {
      trigger = null;
    }
    if (!trigger || !trigger.isFinite() || trigger.lte(0)) throw badRequest("INVALID_TRIGGER", bi("The stop trigger price is invalid.", "스탑 트리거 가격이 올바르지 않습니다."));
    price = req.isBuy ? trigger.mul(STOP_SLIPPAGE.plus(1)) : trigger.mul(new Decimal(1).minus(STOP_SLIPPAGE));
  } else {
    if (!req.price) throw badRequest("PRICE_REQUIRED", bi("Limit orders require a price.", "지정가 주문에는 가격이 필요합니다."));
    price = new Decimal(req.price);
    if (!price.isFinite() || price.lte(0)) throw badRequest("INVALID_PRICE", bi("The price is invalid.", "가격이 올바르지 않습니다."));
    // Fat-finger guard: limit price within ±20% of mid.
    if (price.minus(mid).abs().div(mid).gt(0.2)) {
      await reject(db, user, ctx.botId, "PRICE_OUT_OF_BAND", bi("The limit price is more than ±20% away from the current price.", "지정가가 현재가 대비 ±20% 범위를 벗어났습니다."), 400);
    }
    tif = req.tif ?? "Gtc";
  }
  const px = formatPerpPrice(price, asset.szDecimals);
  const triggerPx = trigger ? formatPerpPrice(trigger, asset.szDecimals) : null;
  const sz = formatPerpSize(size, asset.szDecimals);
  const notional = new Decimal(sz).mul(mid);
  if (notional.gt(maxOrderUsd) && !req.reduceOnly) {
    await reject(db, user, ctx.botId, "ORDER_TOO_LARGE", bi(`The order amount exceeds the per-order limit (${maxOrderUsd.toFixed()} USDC).`, `주문 금액이 1회 한도(${maxOrderUsd.toFixed()} USDC)를 초과합니다.`), 400);
  }
  // Closing orders may be smaller than the minimum (e.g. the rest of a position).
  if (notional.lt(10) && !req.reduceOnly) throw badRequest("ORDER_TOO_SMALL", bi("The order is below Hyperliquid's minimum order amount (10 USDC).", "Hyperliquid 최소 주문 금액(10 USDC) 미만입니다."));

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
      triggerPrice: triggerPx,
      builderFeeTenthsBp: feeTenthsBp,
      status: "PENDING",
    })
    .returning();

  const agentKey = decryptAgentKey(agent!.encryptedKey, agent!.agentAddress);
  try {
    const [status] = await hl.placeOrders(
      agentKey,
      [
        {
          a: asset.index,
          b: req.isBuy,
          p: px,
          s: sz,
          r: Boolean(req.reduceOnly),
          t: triggerPx ? { trigger: { isMarket: true, triggerPx, tpsl: "sl" } } : { limit: { tif } },
          c: cloid,
        },
      ],
      feeTenthsBp > 0 ? { b: cfg.builderAddress!.toLowerCase() as `0x${string}`, f: feeTenthsBp } : undefined,
    );
    const update = interpretStatus(status);
    const [saved] = await db.update(orders).set({ ...update, updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
    return saved;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof HlRejectedError) {
      const [saved] = await db
        .update(orders)
        .set({ status: "REJECTED", error: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(orders.id, order.id))
        .returning();
      return saved;
    }
    // No answer (timeout, network): the order may have reached Hyperliquid and filled.
    // Look it up by cloid before deciding; never report "failed" for an order that may be live.
    const found = await lookupOrder(hl, user.walletAddress, cloid, order.createdAt.getTime() - 60_000);
    const update: Partial<typeof orders.$inferInsert> = found ?? {
      status: "UNKNOWN",
      error: `No response from Hyperliquid and the order isn't visible yet; its result is being checked. (${message})`.slice(0, 500),
    };
    const [saved] = await db.update(orders).set({ ...update, updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
    await db.insert(riskEvents).values({
      userId: user.id,
      botId: ctx.botId ?? null,
      kind: found ? "ORDER_RESPONSE_LOST" : "ORDER_RESULT_UNKNOWN",
      severity: found ? "WARN" : "CRITICAL",
      detail: { orderId: order.id, cloid, message, recovered: found?.status ?? null },
    });
    return saved;
  }
}

/** Waits before each lookup of an order whose response was lost (it may still be in flight). Tests shorten it. */
export const orderLookup = { delaysMs: [0, 800, 2000] };

/** Hyperliquid's own record of an order, mapped to our order row. null = Hyperliquid doesn't know it (yet). */
export async function lookupOrder(hl: HlGateway, wallet: string, cloid: string, sinceMs: number): Promise<Partial<typeof orders.$inferInsert> | null> {
  for (const wait of orderLookup.delaysMs) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const found = await hl.orderStatus(wallet, cloid as `0x${string}`).catch(() => null);
    if (found) return fromLookup(hl, wallet, found, sinceMs);
  }
  return null;
}

async function fromLookup(hl: HlGateway, wallet: string, o: HlOrderLookup, sinceMs: number): Promise<Partial<typeof orders.$inferInsert>> {
  if (o.status === "open" || o.status === "triggered") return { status: "RESTING", hlOrderId: o.oid, error: null };
  const filled = Decimal.max(new Decimal(o.origSz).minus(o.sz), 0);
  if (filled.gt(0)) {
    // A market (IOC) order that filled partly ends "canceled" with the rest unfilled: what filled counts.
    let avgPrice: string | null = null;
    const fills = (await hl.userFillsByTime(wallet, sinceMs).catch(() => [])).filter((f) => f.oid === o.oid);
    const size = fills.reduce((s, f) => s.plus(f.sz), new Decimal(0));
    if (size.gt(0)) avgPrice = fills.reduce((s, f) => s.plus(new Decimal(f.px).mul(f.sz)), new Decimal(0)).div(size).toString();
    return { status: "FILLED", hlOrderId: o.oid, filledSize: filled.toString(), avgPrice, error: null };
  }
  return { status: /rejected/i.test(o.status) ? "REJECTED" : "CANCELED", hlOrderId: o.oid, error: `Hyperliquid: ${o.status}` };
}

/** Orders left UNKNOWN (or stuck PENDING) by a lost response: ask Hyperliquid again. Runs from the engine cron. */
export async function reconcileOrders(db: Db, hl: HlGateway, olderThanMs = 30_000) {
  const stuck = await db
    .select()
    .from(orders)
    .where(and(eq(orders.network, hl.network), inArray(orders.status, ["UNKNOWN", "PENDING"])))
    .limit(50);
  let resolved = 0;
  for (const o of stuck) {
    if (Date.now() - o.createdAt.getTime() < olderThanMs) continue;
    const found = await hl.orderStatus(o.hlAddress, o.cloid as `0x${string}`).catch(() => null);
    if (found) {
      await db.update(orders).set({ ...(await fromLookup(hl, o.hlAddress, found, o.createdAt.getTime() - 60_000)), updatedAt: new Date() }).where(eq(orders.id, o.id));
      resolved++;
    } else if (Date.now() - o.createdAt.getTime() > 10 * 60_000) {
      // Hyperliquid keeps every order it accepted; ten minutes on, an unknown cloid never reached it.
      await db.update(orders).set({ status: "ERROR", error: "Never reached Hyperliquid (no order with this cloid).", updatedAt: new Date() }).where(eq(orders.id, o.id));
      resolved++;
    }
  }
  return resolved;
}

function interpretStatus(status: unknown): Partial<typeof orders.$inferInsert> {
  if (status && typeof status === "object") {
    if ("resting" in status) return { status: "RESTING", hlOrderId: (status as { resting: { oid: number } }).resting.oid };
    if ("filled" in status) {
      const f = (status as { filled: { oid: number; totalSz?: string; avgPx?: string } }).filled;
      return { status: "FILLED", hlOrderId: f.oid, filledSize: f.totalSz ?? null, avgPrice: f.avgPx ?? null };
    }
    if ("error" in status) return { status: "REJECTED", error: String((status as { error: string }).error) };
  }
  return { status: "ERROR", error: `Unexpected status: ${JSON.stringify(status)}` };
}

export async function cancelOrder(db: Db, hl: HlGateway, user: SessionUser, orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.userId !== user.id) throw notFound(bi("Order not found.", "주문을 찾을 수 없습니다."));
  if (order.status !== "RESTING") throw conflict("NOT_CANCELABLE", bi("Only open orders can be canceled.", "미체결 주문만 취소할 수 있습니다."));
  const agent = await activeAgent(db, user.id, hl.network);
  if (!agent) throw forbidden(bi("You need to approve trading permission (agent wallet).", "거래 권한(에이전트) 승인이 필요합니다."));
  const asset = (await hl.perpAssets()).find((a) => a.name === order.coin);
  if (!asset) throw badRequest("UNKNOWN_MARKET", bi("Market information not found.", "마켓 정보를 찾을 수 없습니다."));
  await hl.cancelByCloid(decryptAgentKey(agent.encryptedKey, agent.agentAddress), asset.index, order.cloid as `0x${string}`);
  const [saved] = await db.update(orders).set({ status: "CANCELED", updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
  return saved;
}

export async function listUserOrders(db: Db, userId: string, limit = 50) {
  return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)).limit(limit);
}
