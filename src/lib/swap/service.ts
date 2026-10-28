import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { writeAudit } from "../audit";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { swapDeployments, swapFills, swapOrders, swapTokens } from "../db/schema";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../http";
import { enabledSwapChain, MAX_ORDER_LIFETIME_SEC } from "./config";
import { hashSwapOrder, orderFromJson, type SwapOrder, type SwapOrderJson } from "./order";
import { isExpectedSwapCode, type SwapChainReader } from "./reader";
import { bi } from "../i18n";

type OrderRow = typeof swapOrders.$inferSelect;

function requireChain(chainId: number) {
  const chain = enabledSwapChain(chainId);
  if (!chain) throw badRequest("CHAIN_NOT_ENABLED", bi("Unsupported chain.", "지원하지 않는 체인입니다."));
  return chain;
}

function parseAddress(value: string, fieldEn: string, fieldKo: string): Address {
  if (!isAddress(value, { strict: false })) {
    throw badRequest("INVALID_ADDRESS", bi(`The ${fieldEn} address is invalid.`, `${fieldKo} 주소가 올바르지 않습니다.`));
  }
  return getAddress(value);
}

export async function getDeployment(db: Db, chainId: number) {
  const [d] = await db.select().from(swapDeployments).where(eq(swapDeployments.chainId, chainId)).limit(1);
  return d ?? null;
}

async function requireDeployment(db: Db, chainId: number) {
  const d = await getDeployment(db, chainId);
  if (!d) throw new ApiError(409, "CONTRACT_NOT_DEPLOYED", bi("The swap contract isn't deployed on this chain yet.", "이 체인에는 아직 스왑 컨트랙트가 배포되지 않았습니다."));
  return d;
}

// ── Contract deployment record (admin) ───────────────────────────────────────

/**
 * Records a settlement contract deployed by an admin's wallet. The server reads
 * the deployment receipt and accepts it only if the runtime code matches the
 * compiled artifact (immutables masked).
 */
export async function recordDeployment(db: Db, reader: SwapChainReader, admin: SessionUser, chainId: number, txHash: string) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  requireChain(chainId);
  if (!isHex(txHash) || txHash.length !== 66) throw badRequest("INVALID_TX_HASH", bi("Invalid transaction hash format.", "트랜잭션 해시 형식이 올바르지 않습니다."));
  const dep = await reader.deploymentFromTx(chainId, txHash as Hex);
  const check = isExpectedSwapCode(dep.code);
  if (!check.ok) throw conflict("CODE_MISMATCH", bi("The deployed code doesn't match the verified swap contract.", "배포된 코드가 검증된 스왑 컨트랙트와 일치하지 않습니다."));
  const before = await getDeployment(db, chainId);
  const values = {
    chainId,
    contractAddress: dep.contractAddress.toLowerCase(),
    txHash: txHash.toLowerCase(),
    deployedByUserId: admin.id,
    deployer: dep.deployer.toLowerCase(),
    codeHash: check.codeHash,
    verifiedAt: new Date(),
  };
  await db.insert(swapDeployments).values(values).onConflictDoUpdate({ target: swapDeployments.chainId, set: values });
  await writeAudit(db, {
    actorUserId: admin.id,
    actorWallet: admin.walletAddress,
    action: before ? "SWAP_CONTRACT_REPLACED" : "SWAP_CONTRACT_RECORDED",
    targetType: "swap_chain",
    targetId: String(chainId),
    before,
    after: values,
  });
  return values;
}

// ── Tokens ──────────────────────────────────────────────────────────────────

export async function listTokens(db: Db, chainId: number) {
  return db
    .select()
    .from(swapTokens)
    .where(eq(swapTokens.chainId, chainId))
    .orderBy(desc(swapTokens.listed), asc(swapTokens.symbol));
}

/** Adds a custom token by contract address; metadata is read from the chain. */
export async function addToken(db: Db, reader: SwapChainReader, user: SessionUser, chainId: number, address: string) {
  requireChain(chainId);
  const token = parseAddress(address, "token", "토큰");
  const [existing] = await db
    .select()
    .from(swapTokens)
    .where(and(eq(swapTokens.chainId, chainId), eq(swapTokens.address, token.toLowerCase())))
    .limit(1);
  if (existing) return existing;
  let meta;
  try {
    meta = await reader.tokenMetadata(chainId, token);
  } catch {
    throw badRequest("NOT_A_TOKEN", bi("Couldn't read ERC-20 token info (symbol/name/decimals) from this address.", "이 주소에서 ERC-20 토큰 정보(symbol/name/decimals)를 읽을 수 없습니다."));
  }
  if (!Number.isInteger(meta.decimals) || meta.decimals < 0 || meta.decimals > 36) {
    throw badRequest("UNSUPPORTED_DECIMALS", bi("Unsupported decimals value.", "지원하지 않는 decimals 값입니다."));
  }
  const [row] = await db
    .insert(swapTokens)
    .values({
      chainId,
      address: token.toLowerCase(),
      symbol: meta.symbol || "?",
      name: meta.name || meta.symbol || "Unknown",
      decimals: meta.decimals,
      listed: false,
      addedByUserId: user.id,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? (await listTokens(db, chainId)).find((t) => t.address === token.toLowerCase())!;
}

export async function setTokenListed(db: Db, admin: SessionUser, tokenId: string, listed: boolean) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  const [row] = await db.update(swapTokens).set({ listed }).where(eq(swapTokens.id, tokenId)).returning();
  if (!row) throw notFound(bi("Token not found.", "토큰을 찾을 수 없습니다."));
  await writeAudit(db, {
    actorUserId: admin.id,
    actorWallet: admin.walletAddress,
    action: listed ? "SWAP_TOKEN_LISTED" : "SWAP_TOKEN_UNLISTED",
    targetType: "swap_token",
    targetId: row.id,
    after: { chainId: row.chainId, address: row.address, symbol: row.symbol },
  });
  return row;
}

// ── Orders ──────────────────────────────────────────────────────────────────

export function orderOf(row: OrderRow): SwapOrder {
  return {
    maker: getAddress(row.maker),
    sellToken: getAddress(row.sellToken),
    buyToken: getAddress(row.buyToken),
    sellAmount: BigInt(row.sellAmount),
    buyAmount: BigInt(row.buyAmount),
    taker: getAddress(row.taker),
    expiry: BigInt(row.expiry),
    nonce: BigInt(row.nonce),
  };
}

/**
 * Accepts a signed order. The maker must be the signed-in wallet, both tokens
 * must be registered on the chain, the signature must verify against the
 * deployed contract's EIP-712 domain, and the maker must already hold and have
 * approved the sell amount. The order book only ever shows orders that the
 * contract would accept at the time of posting.
 */
export async function createOrder(
  db: Db,
  reader: SwapChainReader,
  user: SessionUser,
  input: { chainId: number; order: SwapOrderJson; signature: string },
) {
  requireChain(input.chainId);
  const dep = await requireDeployment(db, input.chainId);
  let order: SwapOrder;
  try {
    order = orderFromJson(input.order);
  } catch (e) {
    throw badRequest("INVALID_ORDER", e instanceof Error ? e.message : bi("Invalid order format.", "주문 형식이 올바르지 않습니다."));
  }
  if (!isHex(input.signature) || input.signature.length < 132) throw badRequest("INVALID_SIGNATURE", bi("Invalid signature format.", "서명 형식이 올바르지 않습니다."));
  if (order.maker.toLowerCase() !== user.walletAddress) throw forbidden(bi("The order's maker address doesn't match your signed-in wallet.", "주문의 판매자 주소가 로그인한 지갑과 다릅니다."));
  if (order.sellToken === order.buyToken) throw badRequest("SAME_TOKEN", bi("You can't swap a token for itself.", "같은 토큰끼리는 교환할 수 없습니다."));
  if (order.sellAmount <= 0n || order.buyAmount <= 0n) throw badRequest("ZERO_AMOUNT", bi("Amounts must be greater than 0.", "수량은 0보다 커야 합니다."));
  const now = reader.now();
  if (order.expiry <= BigInt(now + 60)) throw badRequest("EXPIRY_TOO_SOON", bi("The expiry must be at least 1 minute from now.", "만료 시각은 최소 1분 이후여야 합니다."));
  if (order.expiry > BigInt(now + MAX_ORDER_LIFETIME_SEC)) throw badRequest("EXPIRY_TOO_LATE", bi("Orders can be valid for at most 90 days.", "주문 유효기간은 최대 90일입니다."));

  const tokens = await db
    .select()
    .from(swapTokens)
    .where(
      and(
        eq(swapTokens.chainId, input.chainId),
        inArray(swapTokens.address, [order.sellToken.toLowerCase(), order.buyToken.toLowerCase()]),
      ),
    );
  if (tokens.length !== 2) throw badRequest("TOKEN_NOT_REGISTERED", bi("Add both tokens to the token list first.", "두 토큰 모두 먼저 토큰 목록에 추가해야 합니다."));

  const contract = getAddress(dep.contractAddress);
  const orderHash = hashSwapOrder(input.chainId, contract, order);
  const sigOk = await reader.verifyOrderSignature(input.chainId, contract, order, input.signature as Hex).catch(() => false);
  if (!sigOk) throw badRequest("INVALID_SIGNATURE", bi("The order signature doesn't match the maker's wallet.", "주문 서명이 판매자 지갑과 일치하지 않습니다."));

  const state = await reader.orderState(input.chainId, contract, order, orderHash);
  if (state.cancelled || order.nonce < state.minNonce) throw conflict("ORDER_CANCELLED", bi("This order has already been canceled.", "이미 취소된 주문입니다."));
  if (state.filledBuyAmount >= order.buyAmount) throw conflict("ORDER_FILLED", bi("This order has already been fully filled.", "이미 체결이 끝난 주문입니다."));

  const funds = await reader.balanceAndAllowance(input.chainId, order.sellToken, order.maker, contract);
  if (funds.balance < order.sellAmount) throw badRequest("INSUFFICIENT_BALANCE", bi("You don't have enough of the token you're selling.", "판매할 토큰 잔고가 부족합니다."));
  if (funds.allowance < order.sellAmount) throw badRequest("INSUFFICIENT_ALLOWANCE", bi("You need to approve the swap contract to spend the sell amount of your token.", "스왑 컨트랙트에 판매 수량만큼 토큰 사용 승인(approve)이 필요합니다."));

  const [row] = await db
    .insert(swapOrders)
    .values({
      chainId: input.chainId,
      contractAddress: dep.contractAddress,
      orderHash,
      makerUserId: user.id,
      maker: order.maker.toLowerCase(),
      sellToken: order.sellToken.toLowerCase(),
      buyToken: order.buyToken.toLowerCase(),
      sellAmount: order.sellAmount.toString(),
      buyAmount: order.buyAmount.toString(),
      taker: order.taker.toLowerCase(),
      expiry: Number(order.expiry),
      nonce: order.nonce.toString(),
      signature: input.signature.toLowerCase(),
      status: "OPEN",
      filledBuyAmount: state.filledBuyAmount.toString(),
      lastSyncedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw conflict("DUPLICATE_ORDER", bi("This order is already registered.", "이미 등록된 주문입니다."));
  return row;
}

function statusFrom(row: OrderRow, state: { filledBuyAmount: bigint; cancelled: boolean; minNonce: bigint }, now: number) {
  if (state.cancelled || BigInt(row.nonce) < state.minNonce) return "CANCELLED";
  if (state.filledBuyAmount >= BigInt(row.buyAmount)) return "FILLED";
  if (row.expiry <= now) return "EXPIRED";
  return "OPEN";
}

/** Refreshes one order from the contract (the source of truth). */
export async function syncOrder(db: Db, reader: SwapChainReader, orderId: string) {
  const [row] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId)).limit(1);
  if (!row) throw notFound(bi("Order not found.", "주문을 찾을 수 없습니다."));
  const state = await reader.orderState(row.chainId, getAddress(row.contractAddress), orderOf(row), row.orderHash as Hex);
  const status = statusFrom(row, state, reader.now());
  const [saved] = await db
    .update(swapOrders)
    .set({ status, filledBuyAmount: state.filledBuyAmount.toString(), lastSyncedAt: new Date() })
    .where(eq(swapOrders.id, row.id))
    .returning();
  return saved;
}

/**
 * Records fills from a transaction receipt (any number of OrderFilled events
 * of the deployed contract) and resyncs the affected orders. Idempotent.
 */
export async function recordFills(db: Db, reader: SwapChainReader, chainId: number, txHash: string) {
  requireChain(chainId);
  if (!isHex(txHash) || txHash.length !== 66) throw badRequest("INVALID_TX_HASH", bi("Invalid transaction hash format.", "트랜잭션 해시 형식이 올바르지 않습니다."));
  const dep = await requireDeployment(db, chainId);
  const logs = await reader.fillLogs(chainId, getAddress(dep.contractAddress), txHash as Hex);
  if (logs.length === 0) throw badRequest("NO_FILLS", bi("No swap fill events were found in this transaction.", "이 트랜잭션에서 스왑 체결 이벤트를 찾지 못했습니다."));
  let recorded = 0;
  for (const l of logs) {
    const inserted = await db
      .insert(swapFills)
      .values({
        chainId,
        orderHash: l.orderHash.toLowerCase(),
        txHash: txHash.toLowerCase(),
        logIndex: l.logIndex,
        blockNumber: Number(l.blockNumber),
        maker: l.maker.toLowerCase(),
        taker: l.taker.toLowerCase(),
        sellAmountFilled: l.sellAmountFilled.toString(),
        buyAmountFilled: l.buyAmountFilled.toString(),
      })
      .onConflictDoNothing()
      .returning();
    recorded += inserted.length;
  }
  const hashes = [...new Set(logs.map((l) => l.orderHash.toLowerCase()))];
  const rows = await db
    .select()
    .from(swapOrders)
    .where(and(eq(swapOrders.chainId, chainId), inArray(swapOrders.orderHash, hashes)));
  for (const r of rows) await syncOrder(db, reader, r.id);
  return { events: logs.length, recorded, ordersSynced: rows.length };
}

export interface OrderBookFilter {
  chainId: number;
  tokenA?: string;
  tokenB?: string;
  makerUserId?: string;
  status?: string[];
}

/** Orders for a pair in both directions (A→B and B→A), newest first. */
export async function listOrders(db: Db, f: OrderBookFilter, now = Math.floor(Date.now() / 1000)) {
  const a = f.tokenA?.toLowerCase();
  const b = f.tokenB?.toLowerCase();
  const rows = await db
    .select()
    .from(swapOrders)
    .where(
      and(
        eq(swapOrders.chainId, f.chainId),
        f.makerUserId ? eq(swapOrders.makerUserId, f.makerUserId) : undefined,
        a && b
          ? or(
              and(eq(swapOrders.sellToken, a), eq(swapOrders.buyToken, b)),
              and(eq(swapOrders.sellToken, b), eq(swapOrders.buyToken, a)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(swapOrders.createdAt))
    .limit(200);
  // Time-based expiry needs no chain call.
  return rows
    .map((r) => (r.status === "OPEN" && r.expiry <= now ? { ...r, status: "EXPIRED" } : r))
    .filter((r) => !f.status || f.status.includes(r.status));
}

/** JSON for the client: the order tuple + signature needed to call fill(). */
export function orderView(row: OrderRow) {
  const o = orderOf(row);
  return {
    id: row.id,
    chainId: row.chainId,
    contractAddress: row.contractAddress,
    orderHash: row.orderHash,
    status: row.status,
    filledBuyAmount: row.filledBuyAmount,
    remainingBuyAmount: (o.buyAmount - BigInt(row.filledBuyAmount)).toString(),
    createdAt: row.createdAt,
    order: {
      maker: o.maker,
      sellToken: o.sellToken,
      buyToken: o.buyToken,
      sellAmount: o.sellAmount.toString(),
      buyAmount: o.buyAmount.toString(),
      taker: o.taker,
      expiry: o.expiry.toString(),
      nonce: o.nonce.toString(),
    },
    signature: row.signature,
  };
}
