import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import { E2E_KEYS, installTestWallet, signInViaUi } from "./wallets";

async function walletPage(browser: Browser, key: `0x${string}`) {
  const context = await browser.newContext();
  const account = await installTestWallet(context, key);
  const page = await context.newPage();
  return { context, page, account };
}

/** API calls carry the session cookie of the page's context plus a same-origin header. */
function api(request: APIRequestContext, baseURL: string) {
  const headers = { origin: baseURL, "content-type": "application/json" };
  return {
    post: (url: string, data: unknown = {}) => request.post(url, { headers, data }),
    patch: (url: string, data: unknown) => request.patch(url, { headers, data }),
    get: (url: string) => request.get(url),
  };
}

const botInput = (slug: string, fee = 20) => ({
  name: "E2E Trend",
  slug,
  summary: "Trend-following bot for E2E tests.",
  description: "A bot used only in E2E tests. Uses moving-average crossovers and an ATR stop loss.",
  strategyType: "TREND_FOLLOWING",
  markets: ["BTC-PERP"],
  direction: "BOTH",
  leverageMin: 1,
  leverageMax: 3,
  timeframe: "1h",
  orderTypes: ["MARKET"],
  risk: { maxOrderUsd: 100, maxPositionUsd: 500, maxLeverage: 3, stopLossPct: 5, dailyLossLimitUsd: 50, emergencyStop: true },
  executionMode: "PLATFORM_TEMPLATE",
  developer: { bio: "e2e" },
  feeTenthsBp: fee,
  consents: { terms: true, risk: true, performancePolicy: true },
  ownerWalletAddress: "0x000000000000000000000000000000000000dEaD",
});

test("no email/password login; MetaMask sign-in and logout work", async ({ browser }) => {
  const { page, account, context } = await walletPage(browser, E2E_KEYS.trader);
  await page.goto("/");
  await expect(page.locator('input[type="password"], input[type="email"]')).toHaveCount(0);
  await signInViaUi(page);
  await expect(page.getByRole("link", { name: new RegExp(account.address.slice(0, 6)) })).toBeVisible();
  // The wallet was asked to switch to the HyperEVM testnet (998) before signing.
  expect(await page.evaluate(() => (window as unknown as { __ctcChainSwitches: number }).__ctcChainSwitches)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { ethereum: { request(a: object): Promise<string> } }).ethereum.request({ method: "eth_chainId" }))).toBe("0x3e6");
  const me = await (await page.request.get("/api/me")).json();
  expect(me.user.walletAddress).toBe(account.address.toLowerCase());
  // My page shows where the USDC is (HyperEVM / Spot / Perps) and a Spot ⇄ Perps transfer.
  await page.goto("/portfolio");
  const balances = page.getByTestId("usdc-balances");
  await expect(balances).toContainText("Hyperliquid Spot USDC", { timeout: 30_000 });
  await expect(balances).toContainText("Hyperliquid Perps (trading)");
  await expect(balances.getByRole("button", { name: "Transfer" })).toBeDisabled();
  await balances.getByLabel("Amount (USDC)", { exact: true }).fill("5");
  await expect(balances).toContainText("That's more than is available.");
  // Deposit from Arbitrum into Hyperliquid, with the 5 USDC minimum enforced before MetaMask opens.
  const deposit = page.getByTestId("deposit-panel");
  await expect(deposit).toContainText("Deposit USDC to Hyperliquid");
  await expect(deposit).toContainText("Arbitrum Sepolia");
  await deposit.getByLabel("Deposit amount (USDC)").fill("3");
  await expect(deposit).toContainText("minimum deposit is 5 USDC");
  await expect(deposit.getByRole("button", { name: "Deposit", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByTestId("connect-wallet")).toBeVisible();
  expect((await (await page.request.get("/api/me")).json()).user).toBeNull();
  await context.close();
});

test("switching the wallet account ends the session", async ({ browser }) => {
  const { page, context } = await walletPage(browser, E2E_KEYS.trader);
  await page.goto("/");
  await signInViaUi(page);
  await page.evaluate(() => (window as unknown as { __ctcSwitchAccount: (a: string) => void }).__ctcSwitchAccount("0x0000000000000000000000000000000000000001"));
  await expect(page.getByText(/Your wallet account changed, so you were signed out/)).toBeVisible();
  await expect(page.getByTestId("connect-wallet")).toBeVisible();
  await context.close();
});

test("/admin and /partner are blocked for regular users in UI and API", async ({ browser, baseURL }) => {
  const { page, context } = await walletPage(browser, E2E_KEYS.trader);
  await page.goto("/");
  await signInViaUi(page);
  const r = api(page.request, baseURL!);
  expect((await page.goto("/admin"))!.status()).toBe(404);
  expect((await page.goto("/partner"))!.status()).toBe(404);
  expect((await r.get("/api/admin/fees/ledger")).status()).toBe(403);
  expect((await r.get("/api/admin/bots/pending")).status()).toBe(403);
  expect((await r.post("/api/admin/fees/confirm", { eventIds: ["x"], reason: "x" })).status()).toBe(403);
  expect((await r.get("/api/partner/summary")).status()).toBe(403);
  // Users cannot make themselves partners; the referral program is not offered publicly.
  expect((await r.post("/api/partner/activate", { acceptPartnerTerms: true })).status()).toBe(404);
  expect((await r.post("/api/admin/partners", { walletAddress: "0x0000000000000000000000000000000000000001" })).status()).toBe(403);
  // Not linked from the main menu either, and no partner section on My page.
  await page.goto("/");
  await expect(page.locator('header a[href="/admin"], header a[href="/partner"], header a[href="/partners"]')).toHaveCount(0);
  expect((await page.goto("/partners"))!.status()).toBe(404);
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "My page" })).toBeVisible();
  await expect(page.getByTestId("partner-section")).toHaveCount(0);
  await context.close();
});

test("bot lifecycle: forged owner ignored, hidden until approved, admin approves, owner publishes", async ({ browser, baseURL }) => {
  const slug = `e2e-${Date.now()}`;
  const owner = await walletPage(browser, E2E_KEYS.owner);
  await owner.page.goto("/");
  await signInViaUi(owner.page);
  const ro = api(owner.page.request, baseURL!);

  const created = await ro.post("/api/bots", botInput(slug));
  expect(created.status()).toBe(201);
  const { bot } = await created.json();
  expect(bot.ownerWalletAddress).toBe(owner.account.address.toLowerCase());
  expect((await ro.post(`/api/bots/${bot.id}/submit`)).status()).toBe(200);

  // Not public before approval.
  const anon = await browser.newContext();
  expect((await (await anon.request.get("/api/bots")).json()).bots.some((b: { slug: string }) => b.slug === slug)).toBe(false);
  expect((await anon.request.get(`/api/bots/${slug}`)).status()).toBe(404);

  // Another wallet cannot modify it.
  const other = await walletPage(browser, E2E_KEYS.trader);
  await other.page.goto("/");
  await signInViaUi(other.page);
  const rt = api(other.page.request, baseURL!);
  expect((await rt.patch(`/api/bots/${bot.id}`, { ...botInput(slug), name: "hijack" })).status()).toBe(403);

  // Admin (bootstrapped from ADMIN_WALLET_ADDRESS) reviews in the console.
  const admin = await walletPage(browser, E2E_KEYS.admin);
  await admin.page.goto("/");
  await signInViaUi(admin.page);
  await admin.page.goto("/admin");
  await expect(admin.page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expect(admin.page.getByRole("link", { name: /E2E Trend/ })).toBeVisible();
  await admin.page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.page.getByText(/^Approved\. The owner must press/)).toBeVisible();

  // Approved but not yet live → still hidden; owner publishes → visible with verified wallet.
  expect((await anon.request.get(`/api/bots/${slug}`)).status()).toBe(404);
  await owner.page.goto("/portfolio");
  await expect(owner.page.getByRole("link", { name: "Publish →" })).toBeVisible();
  await owner.page.goto(`/bots/${slug}`);
  const banner = owner.page.getByTestId("publish-banner");
  await expect(banner).toContainText("not in the bot market yet");
  await banner.getByRole("button", { name: "Publish to market (LIVE)" }).click();
  await expect(banner).toBeHidden();
  const page = await anon.newPage();
  await page.goto(`/bots/${slug}`);
  await expect(page.getByRole("heading", { name: "E2E Trend" })).toBeVisible();
  await expect(page.getByText("Not enough verified data").first()).toBeVisible();
  await expect(page.getByText(owner.account.address)).toBeVisible();

  // Subscriber consents; a fee increase then requires re-consent.
  expect((await rt.post(`/api/bots/${bot.id}/subscribe`, { acceptedFeeTenthsBp: 20, acceptRisk: true })).status()).toBe(200);
  expect((await ro.patch(`/api/bots/${bot.id}`, { ...botInput(slug, 40) })).status()).toBe(200);
  const stale = await rt.post(`/api/bots/${bot.id}/subscribe`, { acceptedFeeTenthsBp: 20, acceptRisk: true });
  expect(stale.status()).toBe(409);

  // Audit trail recorded and intact.
  const audit = await (await admin.page.request.get("/api/admin/audit-logs")).json();
  expect(audit.brokenAt).toBeNull();
  expect(audit.rows.some((r: { action: string }) => r.action === "BOT_APPROVE")).toBe(true);

  for (const c of [owner.context, other.context, admin.context, anon]) await c.close();
});

test("manual order is refused without trading permission (server gate)", async ({ browser, baseURL }) => {
  const { page, context } = await walletPage(browser, E2E_KEYS.partner);
  await page.goto("/");
  await signInViaUi(page);
  const res = await api(page.request, baseURL!).post("/api/trading/orders", { coin: "BTC", isBuy: true, size: "0.001", orderType: "MARKET" });
  expect(res.status()).toBe(403);
  expect((await res.json()).error.code).toBe("AGENT_NOT_AUTHORIZED");
  // Requests without a same-origin header are refused outright.
  const noOrigin = await page.request.post("/api/trading/orders", { data: {} });
  expect(noOrigin.status()).toBe(403);
  await context.close();
});

test("admin appoints a wholesale partner; client referral link; affiliate joins through the invite link", async ({ browser }) => {
  const { page, context, account } = await walletPage(browser, E2E_KEYS.partner);
  await page.goto("/");
  await signInViaUi(page);
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "My page" })).toBeVisible();
  await expect(page.getByTestId("partner-section")).toHaveCount(0);

  // The admin appoints this wallet in the admin console.
  const admin = await walletPage(browser, E2E_KEYS.admin);
  await admin.page.goto("/");
  await signInViaUi(admin.page);
  await admin.page.goto("/admin");
  await admin.page.getByRole("button", { name: "Partners", exact: true }).click();
  await admin.page.getByLabel("Partner wallet address").fill(account.address);
  await admin.page.getByRole("button", { name: "Appoint wholesale partner" }).click();
  await expect(admin.page.getByText("Wholesale partner appointed.")).toBeVisible();
  await expect(admin.page.getByTestId("admin-partners").getByText("ACTIVE", { exact: true })).toBeVisible();
  await admin.context.close();

  // Now the partner sees the section on My page and reaches the dashboard from it.
  await page.goto("/portfolio");
  const section = page.getByTestId("partner-section");
  await expect(section).toBeVisible();
  const me0 = await (await page.request.get("/api/me")).json();
  const referralCode: string = me0.partner.referralCode;
  expect(referralCode).toMatch(/^[A-Z2-9]{8}$/);
  await expect(section.getByText(`/ref/${referralCode}`)).toBeVisible();
  await section.getByRole("link", { name: "Partner dashboard" }).click();
  await expect(page).toHaveURL(/\/partner$/);
  await expect(page.getByText(referralCode).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();

  // A brand-new wallet arriving via the link is registered under this partner.
  const fresh = await browser.newContext();
  const { privateKeyToAccount, generatePrivateKey } = await import("viem/accounts");
  const key = generatePrivateKey();
  await installTestWallet(fresh, key);
  const p2 = await fresh.newPage();
  await p2.goto(`/ref/${referralCode}`);
  await expect(p2.getByText("✓ Referral code saved.")).toBeVisible();
  await p2.getByRole("button", { name: "Sign up with MetaMask" }).click();
  await p2.getByRole("checkbox").first().check();
  await p2.getByRole("button", { name: /Connect .* and sign/ }).click();
  await p2.getByRole("button", { name: "Sign out" }).waitFor();
  const me = await (await p2.request.get("/api/me")).json();
  expect(me.referredBy.code).toBe(referralCode);
  expect(me.user.walletAddress).toBe(privateKeyToAccount(key).address.toLowerCase());

  const refs = await (await page.request.get("/api/partner/referrals")).json();
  expect(refs.referrals.some((r: { tier: number }) => r.tier === 1)).toBe(true);
  await fresh.close();

  // The wholesale partner sets their portion (10 of the 21 points); the affiliate invite link appears.
  await page.goto("/partner");
  const program = page.getByTestId("affiliate-program");
  await expect(program.getByText("Save your portion first")).toBeVisible();
  await program.getByLabel(/Your portion/).fill("10");
  await expect(program.getByTestId("portion-example")).toContainText("you $10.00 · affiliate $11.00");
  await program.getByRole("button", { name: "Save" }).click();
  const invite = (await program.getByTestId("invite-url").textContent())!.trim();
  expect(invite).toMatch(/\/join\/[A-Z2-9]{10}$/);

  // A new wallet opens the invite link, signs in and joins as an affiliate.
  const affCtx = await browser.newContext();
  await installTestWallet(affCtx, generatePrivateKey());
  const aff = await affCtx.newPage();
  await aff.goto(new URL(invite).pathname);
  await expect(aff.getByTestId("join-terms")).toContainText("invites you to their affiliate program");
  await aff.getByRole("button", { name: "Connect MetaMask to join" }).click();
  await aff.getByRole("checkbox").first().check();
  await aff.getByRole("button", { name: /Connect .* and sign/ }).click();
  await aff.getByRole("button", { name: "Join as an affiliate" }).click();
  await expect(aff).toHaveURL(/\/partner$/);
  await expect(aff.getByRole("heading", { name: "Affiliate dashboard" })).toBeVisible();
  await expect(aff.getByTestId("affiliate-program")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("affiliate-list").getByText("ACTIVE")).toBeVisible();
  await affCtx.close();
  await context.close();
});

test("live Hyperliquid testnet market data is shown on /trade", async ({ page }) => {
  await page.goto("/trade");
  await expect(page.getByText("TESTNET — not real funds")).toBeVisible();
  await expect(page.getByText(/Hyperliquid candles · updated/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/● Live/)).toBeVisible({ timeout: 30_000 });
});

test("swap page: 'opening soon' for users until SWAP_OPEN; admins see 5 chains, locked until a contract is deployed; custom token added from chain metadata", async ({ browser, baseURL }) => {
  const anon = await browser.newPage();
  await anon.goto("/swap");
  await expect(anon.getByTestId("swap-coming-soon")).toContainText("P2P swap is opening soon");
  await expect(anon.getByRole("tab", { name: /Ethereum Sepolia/ })).toHaveCount(0);
  await expect(anon.locator('header a[href="/swap"]')).toBeVisible();
  await anon.close();

  const admin = await walletPage(browser, E2E_KEYS.admin);
  await admin.page.goto("/");
  await signInViaUi(admin.page);
  await admin.page.goto("/swap");
  await expect(admin.page.getByText(/only admins can see the swap below/)).toBeVisible();
  for (const name of ["Ethereum Sepolia", "BNB Smart Chain Testnet", "Polygon Amoy", "Base Sepolia", "Robinhood Chain Testnet"]) {
    await expect(admin.page.getByRole("tab", { name: new RegExp(name) })).toBeVisible();
  }
  await expect(admin.page.getByRole("tab", { name: /BEP-20/ })).toBeVisible();
  await expect(admin.page.getByText(/No swap contract has been deployed on this chain yet/)).toBeVisible();
  const notices = admin.page.getByTestId("swap-notices");
  await expect(notices).toContainText("The platform charges no fee for swaps.");
  await expect(notices).toContainText("Each party to a swap is solely responsible for it.");
  await admin.context.close();

  // Signed-in user adds Circle's Sepolia USDC; symbol/decimals come from the chain.
  const { page, context } = await walletPage(browser, E2E_KEYS.trader);
  await page.goto("/");
  await signInViaUi(page);
  const res = await api(page.request, baseURL!).post("/api/swap/tokens", {
    chainId: 11155111,
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  });
  expect(res.status()).toBe(201);
  const { token } = await res.json();
  expect(token).toMatchObject({ symbol: "USDC", decimals: 6, listed: false });
  // Orders cannot be posted before the contract is deployed on that chain.
  const order = await api(page.request, baseURL!).post("/api/swap/orders", {
    chainId: 11155111,
    signature: "0x" + "11".repeat(65),
    order: { maker: "0x0000000000000000000000000000000000000001", sellToken: token.address, buyToken: token.address, sellAmount: "1", buyAmount: "1", taker: "0x0000000000000000000000000000000000000000", expiry: "9999999999", nonce: "1" },
  });
  expect(order.status()).toBe(409);
  expect((await order.json()).error.code).toBe("CONTRACT_NOT_DEPLOYED");
  await context.close();
});

test("copy trading: the wizard pairs the Copy trading type with the copy execution mode; the leader's bot page explains the copying", async ({ browser, baseURL }) => {
  const { generatePrivateKey } = await import("viem/accounts");
  const { page, context } = await walletPage(browser, generatePrivateKey());
  await page.goto("/");
  await signInViaUi(page);

  await page.goto("/bots/register");
  await page.getByRole("button", { name: /Strategy & source code/ }).click();
  await page.locator('select:has(option[value="COPY_TRADING"])').selectOption("COPY_TRADING");
  await expect(page.getByTestId("copy-trading-help")).toContainText("scaled to each follower's allocation");
  await page.getByRole("button", { name: /Execution & developer/ }).click();
  await expect(page.locator('select:has(option[value="COPY_TRADE"])')).toHaveValue("COPY_TRADE");

  const slug = `copy-${Date.now()}`;
  const res = await api(page.request, baseURL!).post("/api/bots", { ...botInput(slug), strategyType: "COPY_TRADING", executionMode: "COPY_TRADE" });
  expect(res.status()).toBe(201);
  await page.goto(`/bots/${slug}`);
  await expect(page.getByTestId("copy-trading-info")).toContainText("copies each change to followers, scaled to their allocation");
  await context.close();
});

test("docs state: no platform swap fee; each party is responsible for their swap", async ({ page }) => {
  await page.goto("/docs#swap");
  await expect(page.locator("#swap")).toContainText("The platform charges no fee for swaps.");
  await expect(page.locator("#swap")).toContainText("Each party to a swap is solely responsible for it.");
});

test("strategy source: Pine Script pasted in the wizard is analysed, stored privately and shown to the owner", async ({ browser, baseURL }) => {
  const { readFileSync } = await import("node:fs");
  const pathMod = await import("node:path");
  const pine = readFileSync(pathMod.join(process.cwd(), "tests/fixtures/rsi-div-ltf-delta.pine"), "utf8");
  const { generatePrivateKey } = await import("viem/accounts");
  const ctx = await browser.newContext();
  await installTestWallet(ctx, generatePrivateKey());
  const page = await ctx.newPage();
  await page.goto("/");
  await signInViaUi(page);

  // Wizard: attach the script and see the detected header.
  await page.goto("/bots/register");
  await page.getByRole("button", { name: /Strategy & source code/ }).click();
  await page.getByRole("button", { name: "+ Attach source code" }).click();
  await page.getByLabel("Paste code").fill(pine);
  const meta = page.getByTestId("pine-meta");
  await expect(meta.getByText("Pine v6")).toBeVisible();
  await expect(meta.getByText("indicator", { exact: true })).toBeVisible();
  await expect(meta.getByText("12 inputs")).toBeVisible();
  await expect(page.getByText(/indicator\(\) scripts only generate signals/)).toBeVisible();

  // Saved bot (via API with the same payload the wizard sends): owner sees the code, others don't.
  const slug = `src-${Date.now()}`;
  const res = await api(page.request, baseURL!).post("/api/bots", {
    ...botInput(slug),
    source: { language: "PINESCRIPT", visibility: "PRIVATE", code: pine },
  });
  expect(res.status()).toBe(201);
  await page.goto(`/bots/${slug}`);
  const panel = page.getByTestId("bot-source");
  await expect(panel.getByText("Private")).toBeVisible();
  await panel.getByRole("button", { name: "View code" }).click();
  await expect(panel.locator("pre")).toContainText("RSI DIV + LTF DELTA + EMA FILTER V11");
  const anon = await browser.newContext();
  expect((await anon.request.get(`/api/bots/${slug}`)).status()).toBe(404);
  await anon.close();
  await ctx.close();
});

test("beginner guide is public and linked from the header", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('header a[href="/guide"]').first()).toBeAttached();
  await expect(page.locator('footer a[href="/guide"]')).toBeAttached();
  await page.goto("/guide");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("User guide");
  for (const h of ["1. Sign up", "2. Register a bot", "3. Fee (commission) settings in detail", "4. Review", "5. Earnings and payouts"]) {
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(h.replace(/[()]/g, "\\$&")) })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: /per 10,000 USDC filled/ })).toBeVisible();
});

test("the site is English-only: no language switch, English UI and API messages", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("connect-wallet")).toHaveText("Connect MetaMask");
  await expect(page.getByRole("button", { name: "한국어" })).toHaveCount(0);
  // A leftover Korean cookie from the old switch changes nothing.
  await page.context().addCookies([{ name: "ctc_lang", value: "ko", url: page.url() }]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("connect-wallet")).toHaveText("Connect MetaMask");
  const missing = await page.request.get("/api/bots/does-not-exist");
  expect(missing.status()).toBe(404);
  expect((await missing.json()).error.message).not.toMatch(/[가-힣]/);
});

test("bot engine: owner creates a webhook token, signals are accepted and shown, subscribers see what is missing", async ({ browser, baseURL }) => {
  const { generatePrivateKey } = await import("viem/accounts");
  const owner = await walletPage(browser, generatePrivateKey());
  await owner.page.goto("/");
  await signInViaUi(owner.page);
  const ro = api(owner.page.request, baseURL!);
  const slug = `hook-${Date.now()}`;
  const created = await ro.post("/api/bots", { ...botInput(slug), executionMode: "WEBHOOK_SIGNAL" });
  expect(created.status()).toBe(201);
  const { bot } = await created.json();
  expect((await ro.post(`/api/bots/${bot.id}/submit`)).status()).toBe(200);
  const admin = await walletPage(browser, E2E_KEYS.admin);
  await admin.page.goto("/");
  await signInViaUi(admin.page);
  expect((await api(admin.page.request, baseURL!).post(`/api/admin/bots/${bot.id}/approve`)).status()).toBe(200);
  await admin.context.close();
  expect((await ro.post(`/api/bots/${bot.id}/start`)).status()).toBe(200);

  // Owner creates the token on the bot page; it is shown once.
  await owner.page.goto(`/bots/${slug}`);
  const setup = owner.page.getByTestId("webhook-setup");
  await expect(setup).toContainText(`/api/bots/${bot.id}/signal`);
  await setup.getByRole("button", { name: "Create token" }).click();
  const token = (await setup.getByTestId("webhook-token").textContent())!.trim();
  expect(token).toMatch(/^ctc_/);

  // The webhook needs the right token; TradingView-style tickers are accepted; repeats are deduplicated.
  const anon = await browser.newContext();
  const hook = (data: unknown) => anon.request.post(`/api/bots/${bot.id}/signal`, { data });
  expect((await hook({ token: "ctc_wrong_token_wrong_token_wrong", action: "long", coin: "BTC" })).status()).toBe(401);
  expect((await hook({ token, action: "hold", coin: "BTC" })).status()).toBe(400);
  const ok = await hook({ token, action: "long", coin: "BTCUSDT.P", id: "e2e-1" });
  expect(ok.status()).toBe(202);
  expect(await ok.json()).toMatchObject({ action: "LONG", coin: "BTC", engine: "on" });
  expect(await (await hook({ token, action: "long", coin: "BTC", id: "e2e-1" })).json()).toMatchObject({ duplicate: true });

  // The owner sees the processed signal (no subscribers yet).
  await expect(async () => {
    await owner.page.reload();
    await expect(owner.page.getByTestId("bot-signals")).toContainText("PROCESSED");
  }).toPass({ timeout: 20_000 });
  await expect(owner.page.getByTestId("bot-signals")).toContainText("0 subscribers");

  // A subscriber sets an amount and sees what still blocks trading.
  const sub = await walletPage(browser, generatePrivateKey());
  await sub.page.goto("/");
  await signInViaUi(sub.page);
  await sub.page.goto(`/bots/${slug}`);
  await sub.page.getByLabel("Amount per trade (USDC, max 100)").fill("50");
  await sub.page.getByRole("checkbox").first().check();
  await sub.page.getByRole("button", { name: "Subscribe" }).click();
  const readiness = sub.page.getByTestId("bot-readiness");
  await expect(readiness).toContainText("Not trading for you yet");
  await expect(readiness).toContainText("Amount per trade: 50 USDC");
  await expect(readiness).toContainText("Trading permission (agent wallet) approved");
  await expect(readiness.getByRole("link", { name: "Open" }).first()).toHaveAttribute("href", "/trade");

  // Cron endpoints need the shared secret.
  expect((await anon.request.get("/api/cron/engine")).status()).toBe(401);
  const cron = await anon.request.get("/api/cron/engine", { headers: { authorization: "Bearer e2e-cron-secret" } });
  expect(cron.status()).toBe(200);
  expect(await cron.json()).toMatchObject({ engine: "on" });
  await anon.close();
  await sub.context.close();
  await owner.context.close();
});
