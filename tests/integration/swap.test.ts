import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getAddress, keccak256, recoverTypedDataAddress, toHex, zeroAddress, type Address, type Hex } from "viem";
import type { Db } from "@/lib/db/client";
import { swapOrders } from "@/lib/db/schema";
import artifact from "@/lib/swap/artifact.json";
import { ORDER_TYPES, hashSwapOrder, orderToJson, swapDomain, type SwapOrder } from "@/lib/swap/order";
import { isExpectedSwapCode, type FillLog, type SwapChainReader } from "@/lib/swap/reader";
import { addToken, createOrder, listOrders, recordDeployment, recordFills, setTokenListed, syncOrder } from "@/lib/swap/service";
import { verifyAuditChain } from "@/lib/audit";
import { makeUser, testDb, type TestUser } from "../helpers/db";

const CHAIN = 11155111; // Ethereum Sepolia (swap testnet)
const SELL = getAddress("0x1111111111111111111111111111111111111111");
const BUY = getAddress("0x2222222222222222222222222222222222222222");

/** Deployed runtime code with the immutable ranges filled with random bytes. */
function deployedCodeWithImmutables(): Hex {
  const bytes = Buffer.from(artifact.deployedBytecode.slice(2), "hex");
  for (const r of artifact.immutableRanges) randomBytes(r.length).copy(bytes, r.start);
  return toHex(bytes);
}

function fakeReader() {
  const state = new Map<string, { filledBuyAmount: bigint; cancelled: boolean }>();
  const funds = { balance: 10n ** 30n, allowance: 10n ** 30n };
  let code: Hex = deployedCodeWithImmutables();
  let fills: FillLog[] = [];
  const contract = getAddress("0x5fbdb2315678afecb367f032d93f642f64180aa3");
  const reader: SwapChainReader & {
    contract: Address;
    state: typeof state;
    funds: typeof funds;
    setCode(c: Hex): void;
    setFills(f: FillLog[]): void;
  } = {
    contract,
    state,
    funds,
    setCode: (c) => (code = c),
    setFills: (f) => (fills = f),
    tokenMetadata: async (_c, token) => {
      if (token === SELL) return { symbol: "CST", name: "Custom", decimals: 18 };
      if (token === BUY) return { symbol: "USDC", name: "USD Coin", decimals: 6 };
      throw new Error("not a token");
    },
    deploymentFromTx: async () => ({ contractAddress: contract, deployer: contract, code }),
    // Real EIP-712 recovery (EOA), same as the contract for EOAs.
    verifyOrderSignature: async (chainId, c, order, signature) =>
      (await recoverTypedDataAddress({ domain: swapDomain(chainId, c), types: ORDER_TYPES, primaryType: "Order", message: order, signature })) ===
      order.maker,
    orderState: async (_c, _a, _o, hash) => ({ filledBuyAmount: 0n, cancelled: false, minNonce: 0n, ...state.get(hash) }),
    balanceAndAllowance: async () => funds,
    fillLogs: async () => fills,
    now: () => Math.floor(Date.now() / 1000),
  };
  return reader;
}

async function signedOrder(user: TestUser, contract: Address, overrides: Partial<SwapOrder> = {}) {
  const order: SwapOrder = {
    maker: getAddress(user.walletAddress),
    sellToken: SELL,
    buyToken: BUY,
    sellAmount: 100n * 10n ** 18n,
    buyAmount: 250n * 10n ** 6n,
    taker: zeroAddress,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
    nonce: BigInt(Date.now()),
    ...overrides,
  };
  const signature = await user.account.signTypedData({
    domain: swapDomain(CHAIN, contract),
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });
  return { order, signature, json: orderToJson(order) };
}

describe("swap contract deployment record", () => {
  it("accepts only runtime code that matches the compiled artifact", async () => {
    expect(isExpectedSwapCode(deployedCodeWithImmutables()).ok).toBe(true);
    const tampered = Buffer.from(artifact.deployedBytecode.slice(2), "hex");
    tampered[10] ^= 0xff;
    expect(isExpectedSwapCode(toHex(tampered)).ok).toBe(false);
  });

  it("records a verified deployment (admin only) and audits it", async () => {
    const db = await testDb();
    const reader = fakeReader();
    const admin = await makeUser(db, ["TRADER", "ADMIN"]);
    const user = await makeUser(db);
    const tx = keccak256("0x01");
    await expect(recordDeployment(db, reader, user, CHAIN, tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordDeployment(db, reader, admin, 999999, tx)).rejects.toMatchObject({ code: "CHAIN_NOT_ENABLED" });
    reader.setCode("0x6080");
    await expect(recordDeployment(db, reader, admin, CHAIN, tx)).rejects.toMatchObject({ code: "CODE_MISMATCH" });
    reader.setCode(deployedCodeWithImmutables());
    const dep = await recordDeployment(db, reader, admin, CHAIN, tx);
    expect(dep.contractAddress).toBe(reader.contract.toLowerCase());
    expect(await verifyAuditChain(db)).toBeNull();
  });
});

describe("swap orders", () => {
  let db: Db;
  let reader: ReturnType<typeof fakeReader>;
  let maker: TestUser;
  let admin: TestUser;

  beforeEach(async () => {
    db = await testDb();
    reader = fakeReader();
    admin = await makeUser(db, ["TRADER", "ADMIN"]);
    maker = await makeUser(db);
    await recordDeployment(db, reader, admin, CHAIN, keccak256("0x01"));
  });

  it("adds custom tokens from on-chain metadata; admin can list them", async () => {
    const t = await addToken(db, reader, maker, CHAIN, SELL);
    expect(t).toMatchObject({ symbol: "CST", decimals: 18, listed: false, address: SELL.toLowerCase() });
    expect((await addToken(db, reader, maker, CHAIN, SELL)).id).toBe(t.id); // idempotent
    await expect(addToken(db, reader, maker, CHAIN, "0x3333333333333333333333333333333333333333")).rejects.toMatchObject({ code: "NOT_A_TOKEN" });
    await expect(setTokenListed(db, maker, t.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await setTokenListed(db, admin, t.id, true)).listed).toBe(true);
  });

  it("accepts a correctly signed order from the signed-in maker", async () => {
    await addToken(db, reader, maker, CHAIN, SELL);
    await addToken(db, reader, maker, CHAIN, BUY);
    const { order, signature, json } = await signedOrder(maker, reader.contract);
    const row = await createOrder(db, reader, maker, { chainId: CHAIN, order: json, signature });
    expect(row.status).toBe("OPEN");
    expect(row.orderHash).toBe(hashSwapOrder(CHAIN, reader.contract, order));
    await expect(createOrder(db, reader, maker, { chainId: CHAIN, order: json, signature })).rejects.toMatchObject({ code: "DUPLICATE_ORDER" });
    const book = await listOrders(db, { chainId: CHAIN, tokenA: BUY, tokenB: SELL, status: ["OPEN"] });
    expect(book.map((o) => o.id)).toEqual([row.id]);
  });

  it("rejects orders that the contract would not settle", async () => {
    await addToken(db, reader, maker, CHAIN, SELL);
    const other = await makeUser(db);
    // Buy token not registered
    let s = await signedOrder(maker, reader.contract);
    await expect(createOrder(db, reader, maker, { chainId: CHAIN, order: s.json, signature: s.signature })).rejects.toMatchObject({
      code: "TOKEN_NOT_REGISTERED",
    });
    await addToken(db, reader, maker, CHAIN, BUY);
    // Posted by someone other than the maker
    await expect(createOrder(db, reader, other, { chainId: CHAIN, order: s.json, signature: s.signature })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Tampered price after signing
    await expect(
      createOrder(db, reader, maker, { chainId: CHAIN, order: { ...s.json, sellAmount: "1" }, signature: s.signature }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    // Signed for a different contract
    s = await signedOrder(maker, getAddress("0x9999999999999999999999999999999999999999"));
    await expect(createOrder(db, reader, maker, { chainId: CHAIN, order: s.json, signature: s.signature })).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
    });
    // Expiry too soon / too far
    s = await signedOrder(maker, reader.contract, { expiry: BigInt(Math.floor(Date.now() / 1000) + 10) });
    await expect(createOrder(db, reader, maker, { chainId: CHAIN, order: s.json, signature: s.signature })).rejects.toMatchObject({
      code: "EXPIRY_TOO_SOON",
    });
    s = await signedOrder(maker, reader.contract, { expiry: BigInt(Math.floor(Date.now() / 1000) + 200 * 86400) });
    await expect(createOrder(db, reader, maker, { chainId: CHAIN, order: s.json, signature: s.signature })).rejects.toMatchObject({
      code: "EXPIRY_TOO_LATE",
    });
    // No approval / no balance
    s = await signedOrder(maker, reader.contract);
    reader.funds.allowance = 0n;
    await expect(createOrder(db, reader, maker, { chainId: CHAIN, order: s.json, signature: s.signature })).rejects.toMatchObject({
      code: "INSUFFICIENT_ALLOWANCE",
    });
    reader.funds.balance = 0n;
    await expect(createOrder(db, reader, maker, { chainId: CHAIN, order: s.json, signature: s.signature })).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
  });

  it("refuses orders on a chain without a deployed contract", async () => {
    const s = await signedOrder(maker, reader.contract);
    await expect(createOrder(db, reader, maker, { chainId: 97, order: s.json, signature: s.signature })).rejects.toMatchObject({
      code: "CONTRACT_NOT_DEPLOYED",
    });
  });

  it("mirrors on-chain fills and cancels; fill events are recorded once", async () => {
    await addToken(db, reader, maker, CHAIN, SELL);
    await addToken(db, reader, maker, CHAIN, BUY);
    const { order, signature, json } = await signedOrder(maker, reader.contract);
    const row = await createOrder(db, reader, maker, { chainId: CHAIN, order: json, signature });
    const hash = row.orderHash as Hex;
    const taker = getAddress("0x4444444444444444444444444444444444444444");

    reader.state.set(hash, { filledBuyAmount: 100n * 10n ** 6n, cancelled: false });
    reader.setFills([
      { orderHash: hash, maker: order.maker, taker, sellAmountFilled: 40n * 10n ** 18n, buyAmountFilled: 100n * 10n ** 6n, logIndex: 3, blockNumber: 10n },
    ]);
    const tx = keccak256("0xabc");
    expect(await recordFills(db, reader, CHAIN, tx)).toMatchObject({ events: 1, recorded: 1, ordersSynced: 1 });
    expect(await recordFills(db, reader, CHAIN, tx)).toMatchObject({ events: 1, recorded: 0 });
    let [saved] = await db.select().from(swapOrders).where(eq(swapOrders.id, row.id));
    expect(saved).toMatchObject({ status: "OPEN", filledBuyAmount: "100000000" });

    reader.state.set(hash, { filledBuyAmount: order.buyAmount, cancelled: false });
    expect((await syncOrder(db, reader, row.id)).status).toBe("FILLED");

    reader.state.set(hash, { filledBuyAmount: 0n, cancelled: true });
    [saved] = [await syncOrder(db, reader, row.id)];
    expect(saved.status).toBe("CANCELLED");
    expect(await listOrders(db, { chainId: CHAIN, tokenA: SELL, tokenB: BUY, status: ["OPEN"] })).toHaveLength(0);
  });
});
