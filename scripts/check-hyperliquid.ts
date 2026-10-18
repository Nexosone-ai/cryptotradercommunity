/**
 * Read-only pre-flight check against Hyperliquid for the configured network:
 * API reachability, market data, and the builder account requirement
 * (>= 100 USDC perps account value, per Hyperliquid builder-code docs).
 * Sends no orders and signs nothing.
 */
import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";

async function main() {
  const network = process.env.HL_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const info = new InfoClient({ transport: new HttpTransport({ isTestnet: network === "testnet" }) });
  console.log(`Network: ${network}`);

  const meta = await info.meta();
  const mids = await info.allMids();
  console.log(`✓ Info API reachable — ${meta.universe.length} perp markets, BTC mid ${mids.BTC}`);

  const builder = process.env.BUILDER_ADDRESS;
  if (!builder) {
    console.log("• BUILDER_ADDRESS not set — builder-fee features stay disabled.");
    return;
  }
  const state = await info.clearinghouseState({ user: builder as `0x${string}` });
  const value = Number(state.marginSummary.accountValue);
  console.log(`${value >= 100 ? "✓" : "✗"} Builder perps account value: ${value} USDC (requirement: >= 100)`);
  const ref = await info.referral({ user: builder as `0x${string}` });
  console.log(`• Builder rewards (unclaimed): ${ref.unclaimedRewards} · claimed: ${ref.claimedRewards}`);
  if (value < 100) process.exitCode = 2;
}

main().catch((err) => {
  console.error("✗ Hyperliquid check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
