import { defineConfig } from "@playwright/test";
import { E2E_ADMIN_ADDRESS } from "./tests/e2e/wallets";

const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Local runs use the installed Chrome; CI can run `npx playwright install chromium` and unset this.
    channel: process.env.E2E_CHANNEL === "bundled" ? undefined : (process.env.E2E_CHANNEL ?? "chrome"),
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/me`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      APP_URL: `http://localhost:${PORT}`,
      HL_NETWORK: "testnet",
      PGLITE_DATA_DIR: `.data/e2e-${Date.now()}`,
      SESSION_SECRET: "e2e-session-secret-0123456789abcdef0123456789abcdef",
      AGENT_KEY_ENCRYPTION_KEY: "11".repeat(32),
      ADMIN_WALLET_ADDRESS: E2E_ADMIN_ADDRESS,
      BUILDER_ADDRESS: "",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
