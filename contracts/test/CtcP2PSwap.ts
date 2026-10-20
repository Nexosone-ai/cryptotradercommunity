import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseUnits, zeroAddress, type Address, type Hex } from "viem";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer, maker, taker, stranger] = await viem.getWalletClients();

const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "taker", type: "address" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

type Order = {
  maker: Address;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  buyAmount: bigint;
  taker: Address;
  expiry: bigint;
  nonce: bigint;
};

async function deployFixture() {
  const swap = await viem.deployContract("CtcP2PSwap");
  const custom = await viem.deployContract("MockToken", ["Custom", "CST", 18]);
  const usdc = await viem.deployContract("MockToken", ["USD Coin", "USDC", 6]);
  const taxed = await viem.deployContract("FeeOnTransferToken");
  await custom.write.mint([maker.account.address, parseUnits("1000", 18)]);
  await usdc.write.mint([taker.account.address, parseUnits("10000", 6)]);
  await taxed.write.mint([maker.account.address, parseUnits("1000", 18)]);
  // Approvals to the settlement contract (what the UI asks each side to sign).
  const max = 2n ** 256n - 1n;
  await custom.write.approve([swap.address, max], { account: maker.account });
  await taxed.write.approve([swap.address, max], { account: maker.account });
  await usdc.write.approve([swap.address, max], { account: taker.account });
  return { swap, custom, usdc, taxed };
}

async function sign(swapAddress: Address, o: Order, signer = maker): Promise<Hex> {
  const chainId = await publicClient.getChainId();
  return signer.signTypedData({
    account: signer.account,
    domain: { name: "CTC P2P Swap", version: "1", chainId, verifyingContract: swapAddress },
    types: ORDER_TYPES,
    primaryType: "Order",
    message: o,
  });
}

async function baseOrder(sellToken: Address, buyToken: Address, overrides: Partial<Order> = {}): Promise<Order> {
  const now = BigInt(await networkHelpers.time.latest());
  return {
    maker: maker.account.address,
    sellToken,
    buyToken,
    // 100 CST for 250 USDC = 2.5 USDC per CST
    sellAmount: parseUnits("100", 18),
    buyAmount: parseUnits("250", 6),
    taker: zeroAddress,
    expiry: now + 3600n,
    nonce: 1n,
    ...overrides,
  };
}

describe("CtcP2PSwap", () => {
  it("fills a fixed-price order atomically (full fill)", async () => {
    const { swap, custom, usdc } = await networkHelpers.loadFixture(deployFixture);
    const o = await baseOrder(custom.address, usdc.address);
    const sig = await sign(swap.address, o);
    await viem.assertions.emitWithArgs(
      swap.write.fill([o, sig, o.buyAmount], { account: taker.account }),
      swap,
      "OrderFilled",
      [
        await swap.read.hashOrder([o]),
        maker.account.address,
        taker.account.address,
        custom.address,
        usdc.address,
        o.sellAmount,
        o.buyAmount,
      ],
    );
    assert.equal(await custom.read.balanceOf([taker.account.address]), o.sellAmount);
    assert.equal(await usdc.read.balanceOf([maker.account.address]), o.buyAmount);
    assert.equal(await swap.read.remainingBuyAmount([o]), 0n);
    // Tokens never rest in the contract.
    assert.equal(await custom.read.balanceOf([swap.address]), 0n);
    assert.equal(await usdc.read.balanceOf([swap.address]), 0n);
  });

  it("supports partial fills at the signed price and blocks overfill", async () => {
    const { swap, custom, usdc } = await networkHelpers.loadFixture(deployFixture);
    const o = await baseOrder(custom.address, usdc.address);
    const sig = await sign(swap.address, o);
    await swap.write.fill([o, sig, parseUnits("100", 6)], { account: taker.account });
    assert.equal(await custom.read.balanceOf([taker.account.address]), parseUnits("40", 18));
    assert.equal(await swap.read.remainingBuyAmount([o]), parseUnits("150", 6));
    await viem.assertions.revertWithCustomErrorWithArgs(
      swap.write.fill([o, sig, parseUnits("151", 6)], { account: taker.account }),
      swap,
      "FillTooLarge",
      [parseUnits("150", 6)],
    );
    await swap.write.fill([o, sig, parseUnits("150", 6)], { account: taker.account });
    assert.equal(await custom.read.balanceOf([taker.account.address]), o.sellAmount);
  });

  it("rounds in favour of the maker and rejects dust fills that would pay out zero", async () => {
    const { swap, custom, usdc } = await networkHelpers.loadFixture(deployFixture);
    // 1 wei CST for 1 USDC: paying 0.5 USDC would yield 0.5 wei, rounded to 0
    const o = await baseOrder(custom.address, usdc.address, { sellAmount: 1n, buyAmount: parseUnits("1", 6) });
    const sig = await sign(swap.address, o);
    await viem.assertions.revertWithCustomError(
      swap.write.fill([o, sig, parseUnits("0.5", 6)], { account: taker.account }),
      swap,
      "ZeroFill",
    );
  });

  it("rejects forged, tampered, wrong-taker, self, cross-contract and expired fills", async () => {
    const { swap, custom, usdc } = await networkHelpers.loadFixture(deployFixture);
    const o = await baseOrder(custom.address, usdc.address);
    const forged = await sign(swap.address, o, stranger);
    await viem.assertions.revertWithCustomError(
      swap.write.fill([o, forged, o.buyAmount], { account: taker.account }),
      swap,
      "InvalidSignature",
    );
    const sig = await sign(swap.address, o);
    await viem.assertions.revertWithCustomError(
      swap.write.fill([{ ...o, sellAmount: o.sellAmount * 2n }, sig, o.buyAmount], { account: taker.account }),
      swap,
      "InvalidSignature",
    );
    const priv = await baseOrder(custom.address, usdc.address, { taker: stranger.account.address, nonce: 2n });
    await viem.assertions.revertWithCustomError(
      swap.write.fill([priv, await sign(swap.address, priv), priv.buyAmount], { account: taker.account }),
      swap,
      "NotAllowedTaker",
    );
    await viem.assertions.revertWithCustomError(
      swap.write.fill([o, sig, o.buyAmount], { account: maker.account }),
      swap,
      "InvalidOrder",
    );
    const other = await viem.deployContract("CtcP2PSwap");
    const otherSig = await sign(other.address, o);
    await viem.assertions.revertWithCustomError(
      swap.write.fill([o, otherSig, o.buyAmount], { account: taker.account }),
      swap,
      "InvalidSignature",
    );
    await networkHelpers.time.increase(3601);
    await viem.assertions.revertWithCustomError(
      swap.write.fill([o, sig, o.buyAmount], { account: taker.account }),
      swap,
      "OrderExpired",
    );
  });

  it("lets only the maker cancel, individually or in bulk", async () => {
    const { swap, custom, usdc } = await networkHelpers.loadFixture(deployFixture);
    const o = await baseOrder(custom.address, usdc.address);
    const sig = await sign(swap.address, o);
    await viem.assertions.revertWithCustomError(swap.write.cancel([o], { account: taker.account }), swap, "NotMaker");
    await swap.write.cancel([o], { account: maker.account });
    await viem.assertions.revertWithCustomError(
      swap.write.fill([o, sig, o.buyAmount], { account: taker.account }),
      swap,
      "OrderCancelledOrInvalidNonce",
    );
    const o2 = await baseOrder(custom.address, usdc.address, { nonce: 5n });
    const sig2 = await sign(swap.address, o2);
    await swap.write.cancelUpTo([6n], { account: maker.account });
    await viem.assertions.revertWithCustomError(
      swap.write.fill([o2, sig2, o2.buyAmount], { account: taker.account }),
      swap,
      "OrderCancelledOrInvalidNonce",
    );
    await viem.assertions.revertWithCustomError(
      swap.write.cancelUpTo([6n], { account: maker.account }),
      swap,
      "NonceNotIncreasing",
    );
  });

  it("rejects fee-on-transfer tokens and leaves balances untouched", async () => {
    const { swap, taxed, usdc } = await networkHelpers.loadFixture(deployFixture);
    const o = await baseOrder(taxed.address, usdc.address);
    const sig = await sign(swap.address, o);
    const before = await usdc.read.balanceOf([taker.account.address]);
    await viem.assertions.revertWithCustomError(
      swap.write.fill([o, sig, o.buyAmount], { account: taker.account }),
      swap,
      "InexactTransfer",
    );
    assert.equal(await usdc.read.balanceOf([taker.account.address]), before);
  });

  it("reverts the whole fill if the maker no longer holds the tokens", async () => {
    const { swap, custom, usdc } = await networkHelpers.loadFixture(deployFixture);
    const o = await baseOrder(custom.address, usdc.address);
    const sig = await sign(swap.address, o);
    await custom.write.transfer([deployer.account.address, parseUnits("1000", 18)], { account: maker.account });
    const before = await usdc.read.balanceOf([taker.account.address]);
    await viem.assertions.revertWithCustomError(
      swap.write.fill([o, sig, o.buyAmount], { account: taker.account }),
      custom,
      "ERC20InsufficientBalance",
    );
    assert.equal(await usdc.read.balanceOf([taker.account.address]), before);
    assert.equal(await swap.read.filledBuyAmount([await swap.read.hashOrder([o])]), 0n);
  });

  it("random partial fills never pay out more than the signed price allows", async () => {
    const { swap, custom, usdc } = await networkHelpers.loadFixture(deployFixture);
    const o = await baseOrder(custom.address, usdc.address, {
      sellAmount: parseUnits("7.77", 18),
      buyAmount: parseUnits("13.13", 6),
    });
    const sig = await sign(swap.address, o);
    let paid = 0n;
    let seed = 12345n;
    while (paid < o.buyAmount) {
      seed = (seed * 1103515245n + 12345n) % 2147483648n;
      const left = o.buyAmount - paid;
      const step = left < 3000n ? left : (seed % (left / 3n)) + 1000n;
      await swap.write.fill([o, sig, step], { account: taker.account });
      paid += step;
      const received = await custom.read.balanceOf([taker.account.address]);
      // received / paid must never exceed sellAmount / buyAmount
      assert.ok(received * o.buyAmount <= paid * o.sellAmount);
    }
    assert.equal(paid, o.buyAmount);
  });
});
