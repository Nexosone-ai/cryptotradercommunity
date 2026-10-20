import path from "node:path";
import { defineConfig } from "vitest/config";

/** On-chain integration tests against a local Hardhat node (npm run test:chain). */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/chain/**/*.test.ts"],
    globalSetup: ["tests/chain/setup.ts"],
    env: { SWAP_RPC_11155111: "http://127.0.0.1:8599" },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
