import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseUnits, zeroAddress, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import artifact from "@/lib/swap/artifact.json";
import { ORDER_TYPES, orderToJson, swapDomain, type SwapOrder } from "@/lib/swap/order";
import { createSwapReader } from "@/lib/swap/reader";
import { addToken, createOrder, listOrders, recordDeployment, recordFills, syncOrder } from "@/lib/swap/service";
import type { SessionUser } from "@/lib/auth/session";
import { makeUser, testDb } from "../helpers/db";

// Throwaway local keys (funded via hardhat_setBalance; local node only).
const KEYS = {
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  maker: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  taker: "0x5de4111afa1a4b94908f83103eb1d1706367c2e68ca870fc3fb9a804cdab365a",
} as const;

const RPC = "http://127.0.0.1:8599";
const chain = defineChain({
  id: 11155111,
  name: "Local Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(RPC) });

const mockArtifact = JSON.parse(
  readFileSync(path.join(process.cwd(), "contracts/artifacts/contracts/test/TestTokens.sol/MockToken.json"), "utf8"),
) as { abi: Abi; bytecode: Hex };

async function deploy(key: Hex, abi: Abi, bytecode: Hex, args: unknown[] = []) {
  const hash = await wallet(key).deployContract({ abi, bytecode, args });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { hash, address: getAddress(receipt.contractAddress!) };
}

async function asUser(db: Db, key: Hex, roles: SessionUser["roles"]): Promise<SessionUser> {
  const u = await makeUser(db, roles);
  const address = privateKeyToAccount(key).address.toLowerCase();
  await db.update(users).set({ walletAddress: address }).where((await import("drizzle-orm")).eq(users.id, u.id));
  return { ...u, walletAddress: address as `0x${string}` };
}

describe("P2P swap against a real EVM (local node as chain 11155111)", () => {
  const reader = createSwapReader();
  let db: Db;

  beforeAll(async () => {
    db = await testDb();
    // Fund every test key with local ETH for gas (local node only).
    for (const key of Object.values(KEYS)) {
      await pub.request({
        method: "hardhat_setBalance" as never,
        params: [privateKeyToAccount(key).address, "0x56BC75E2D63100000"] as never,
      });
    }
  });

  it("deploy → verify → custom token → signed order → partial fill → cancel, all from chain data", async () => {
    const admin = await asUser(db, KEYS.admin, ["TRADER", "ADMIN"]);
    const maker = await asUser(db, KEYS.maker, ["TRADER"]);

    // 1. Admin deploys the real settlement contract; server verifies the code (real immutables).
    const swap = await deploy(KEYS.admin, artifact.abi as Abi, artifact.bytecode as Hex);
    const dep = await recordDeployment(db, reader, admin, 11155111, swap.hash);
    expect(dep.contractAddress).toBe(swap.address.toLowerCase());

    // A different contract at another address is rejected by code comparison.
    const fake = await deploy(KEYS.admin, mockArtifact.abi, mockArtifact.bytecode, ["Fake", "FAKE", 18]);
    await expect(recordDeployment(db, reader, admin, 11155111, fake.hash)).rejects.toMatchObject({ code: "CODE_MISMATCH" });
    await recordDeployment(db, reader, admin, 11155111, swap.hash);

    // 2. Custom tokens: metadata read from chain.
    const cst = await deploy(KEYS.admin, mockArtifact.abi, mockArtifact.bytecode, ["Custom Token", "CST", 18]);
    const usd = await deploy(KEYS.admin, mockArtifact.abi, mockArtifact.bytecode, ["Test USD", "TUSD", 6]);
    const t1 = await addToken(db, reader, maker, 11155111, cst.address);
    const t2 = await addToken(db, reader, maker, 11155111, usd.address);
    expect([t1.symbol, t1.decimals, t2.symbol, t2.decimals]).toEqual(["CST", 18, "TUSD", 6]);

    const makerW = wallet(KEYS.maker);
    const takerW = wallet(KEYS.taker);
    const write = async (w: ReturnType<typeof wallet>, address: `0x${string}`, abi: Abi, functionName: string, args: unknown[]) =>
      pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args }) });
    await write(wallet(KEYS.admin), cst.address, mockArtifact.abi, "mint", [makerW.account.address, parseUnits("1000", 18)]);
    await write(wallet(KEYS.admin), usd.address, mockArtifact.abi, "mint", [takerW.account.address, parseUnits("1000", 6)]);

    // 3. Maker signs an order: 100 CST for 250 TUSD. Server refuses it until the maker approves.
    const now = Number((await pub.getBlock()).timestamp);
    const order: SwapOrder = {
      maker: makerW.account.address,
      sellToken: cst.address,
      buyToken: usd.address,
      sellAmount: parseUnits("100", 18),
      buyAmount: parseUnits("250", 6),
      taker: zeroAddress,
      expiry: BigInt(Math.max(now, Math.floor(Date.now() / 1000)) + 3600),
      nonce: 1n,
    };
    const signature = await makerW.signTypedData({ domain: swapDomain(11155111, swap.address), types: ORDER_TYPES, primaryType: "Order", message: order });
    await expect(createOrder(db, reader, maker, { chainId: 11155111, order: orderToJson(order), signature })).rejects.toMatchObject({
      code: "INSUFFICIENT_ALLOWANCE",
    });
    await write(makerW, cst.address, mockArtifact.abi, "approve", [swap.address, order.sellAmount]);
    const row = await createOrder(db, reader, maker, { chainId: 11155111, order: orderToJson(order), signature });
    expect(row.status).toBe("OPEN");

    // 4. Taker fills 40% on-chain; server records it from the receipt event.
    await write(takerW, usd.address, mockArtifact.abi, "approve", [swap.address, parseUnits("100", 6)]);
    const fillHash = await takerW.writeContract({
      address: swap.address,
      abi: artifact.abi as Abi,
      functionName: "fill",
      args: [order, signature, parseUnits("100", 6)],
    });
    await pub.waitForTransactionReceipt({ hash: fillHash });
    expect(await recordFills(db, reader, 11155111, fillHash)).toMatchObject({ events: 1, recorded: 1, ordersSynced: 1 });
    expect(await recordFills(db, reader, 11155111, fillHash)).toMatchObject({ recorded: 0 });
    const balance = await pub.readContract({ address: cst.address, abi: mockArtifact.abi, functionName: "balanceOf", args: [takerW.account.address] });
    expect(balance).toBe(parseUnits("40", 18));
    const [open] = await listOrders(db, { chainId: 11155111, tokenA: cst.address, tokenB: usd.address, status: ["OPEN"] });
    expect(open.filledBuyAmount).toBe(parseUnits("100", 6).toString());

    // 5. Maker cancels on-chain; sync mirrors it and the order leaves the book.
    await write(makerW, swap.address, artifact.abi as Abi, "cancel", [order]);
    expect((await syncOrder(db, reader, row.id)).status).toBe("CANCELLED");
    expect(await listOrders(db, { chainId: 11155111, tokenA: cst.address, tokenB: usd.address, status: ["OPEN"] })).toHaveLength(0);
  });
});
