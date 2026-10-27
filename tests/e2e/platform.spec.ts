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
  summary: "E2E 테스트용 추세 추종 봇입니다.",
  description: "E2E 테스트에서만 사용하는 봇입니다. 이동평균 교차와 ATR 손절을 사용합니다.",
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
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByTestId("connect-wallet")).toBeVisible();
  expect((await (await page.request.get("/api/me")).json()).user).toBeNull();
  await context.close();
});

test("switching the wallet account ends the session", async ({ browser }) => {
  const { page, context } = await walletPage(browser, E2E_KEYS.trader);
  await page.goto("/");
  await signInViaUi(page);
  await page.evaluate(() => (window as unknown as { __ctcSwitchAccount: (a: string) => void }).__ctcSwitchAccount("0x0000000000000000000000000000000000000001"));
  await expect(page.getByText(/지갑 계정이 변경되어 로그아웃/)).toBeVisible();
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
  // Not linked from the main menu either.
  await page.goto("/");
  await expect(page.locator('header a[href="/admin"], header a[href="/partner"]')).toHaveCount(0);
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
  await expect(admin.page.getByRole("heading", { name: "관리자" })).toBeVisible();
  await expect(admin.page.getByRole("link", { name: /E2E Trend/ })).toBeVisible();
  await admin.page.getByRole("button", { name: "승인", exact: true }).click();
  await expect(admin.page.getByText("승인했습니다")).toBeVisible();

  // Approved but not yet live → still hidden; owner publishes → visible with verified wallet.
  expect((await anon.request.get(`/api/bots/${slug}`)).status()).toBe(404);
  expect((await ro.post(`/api/bots/${bot.id}/start`)).status()).toBe(200);
  const page = await anon.newPage();
  await page.goto(`/bots/${slug}`);
  await expect(page.getByRole("heading", { name: "E2E Trend" })).toBeVisible();
  await expect(page.getByText("검증 데이터 부족").first()).toBeVisible();
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

test("partner activation, referral link and two-tier relation", async ({ browser, baseURL }) => {
  const { page, context } = await walletPage(browser, E2E_KEYS.partner);
  await page.goto("/");
  await signInViaUi(page);
  const act = await api(page.request, baseURL!).post("/api/partner/activate", { acceptPartnerTerms: true });
  const { referralCode } = await act.json();
  expect(referralCode).toMatch(/^[A-Z2-9]{8}$/);
  await page.goto("/partner");
  await expect(page.getByText(referralCode).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "CSV 내보내기" })).toBeVisible();

  // A brand-new wallet arriving via the link is registered under this partner.
  const fresh = await browser.newContext();
  const { privateKeyToAccount, generatePrivateKey } = await import("viem/accounts");
  const key = generatePrivateKey();
  await installTestWallet(fresh, key);
  const p2 = await fresh.newPage();
  await p2.goto(`/ref/${referralCode}`);
  await expect(p2.getByText("추천 코드가 저장되었습니다")).toBeVisible();
  await p2.getByRole("button", { name: "MetaMask로 가입하기" }).click();
  await p2.getByRole("checkbox").first().check();
  await p2.getByRole("button", { name: /연결하고 서명하기/ }).click();
  await p2.getByRole("button", { name: "로그아웃" }).waitFor();
  const me = await (await p2.request.get("/api/me")).json();
  expect(me.referredBy.code).toBe(referralCode);
  expect(me.user.walletAddress).toBe(privateKeyToAccount(key).address.toLowerCase());

  const refs = await (await page.request.get("/api/partner/referrals")).json();
  expect(refs.referrals.some((r: { tier: number }) => r.tier === 1)).toBe(true);
  await fresh.close();
  await context.close();
});

test("live Hyperliquid testnet market data is shown on /trade", async ({ page }) => {
  await page.goto("/trade");
  await expect(page.getByText("TESTNET — 실제 자금 아님")).toBeVisible();
  await expect(page.getByText(/Hyperliquid 캔들 · .* 갱신/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("● 실시간")).toBeVisible({ timeout: 30_000 });
});

test("swap page: 5 chains, locked until a contract is deployed, custom token added from chain metadata", async ({ browser, baseURL }) => {
  const anon = await browser.newPage();
  await anon.goto("/swap");
  for (const name of ["Ethereum Sepolia", "BNB Smart Chain Testnet", "Polygon Amoy", "Base Sepolia", "Robinhood Chain Testnet"]) {
    await expect(anon.getByRole("tab", { name: new RegExp(name) })).toBeVisible();
  }
  await expect(anon.getByRole("tab", { name: /BEP-20/ })).toBeVisible();
  await expect(anon.getByText(/아직 스왑 컨트랙트가 배포되지 않아/)).toBeVisible();
  await expect(anon.locator('header a[href="/swap"]')).toBeVisible();
  await anon.close();

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

test("swap page and docs state: no platform swap fee; each party is responsible for their swap", async ({ page }) => {
  await page.goto("/swap");
  const notices = page.getByTestId("swap-notices");
  await expect(notices).toContainText("스왑에 대한 수수료는 플랫폼에서 부과하지 않습니다.");
  await expect(notices).toContainText("스왑에 대한 모든 책임은 스왑을 진행하는 각자가 책임을 집니다.");
  await page.goto("/docs#swap");
  await expect(page.locator("#swap")).toContainText("스왑에 대한 수수료는 플랫폼에서 부과하지 않습니다.");
  await expect(page.locator("#swap")).toContainText("스왑을 진행하는 각자가 책임을 집니다.");
});

test("partner billing: bank top-up → admin credit → customer invoice → payment confirmed → earnings", async ({ browser, baseURL }) => {
  // Fresh partner wallet.
  const { generatePrivateKey } = await import("viem/accounts");
  const ctx = await browser.newContext();
  await installTestWallet(ctx, generatePrivateKey());
  const page = await ctx.newPage();
  await page.goto("/");
  await signInViaUi(page);
  const r = api(page.request, baseURL!);
  expect((await r.post("/api/partner/activate", { acceptPartnerTerms: true })).status()).toBe(200);
  await page.reload();

  // Top-up request shows the company account and a reference code.
  await page.goto("/partner");
  await expect(page.getByTestId("partner-services")).toBeVisible();
  await expect(page.getByText(/영상 생성 서비스\(fal.ai\)가 아직 설정되지 않았습니다/)).toBeVisible();
  await page.getByRole("tab", { name: "크레딧" }).click();
  // Packages are priced in KRW from a live exchange rate, VAT included.
  const packages = page.getByTestId("credit-packages");
  await expect(packages.getByText("$50", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/원화 금액은 부가세 10% 포함/)).toBeVisible();
  await packages.getByRole("button", { name: "구매 요청" }).first().click();
  const instructions = page.getByTestId("topup-instructions");
  await expect(instructions.getByText("000-111-222")).toBeVisible();
  await expect(instructions.getByText(/^₩[\d,]+$/)).toBeVisible();
  const ref = (await instructions.locator("dd.font-bold.text-accent").first().textContent())!.trim();
  expect(ref).toMatch(/^TOP-/);

  // Admin confirms the deposit.
  const admin = await walletPage(browser, E2E_KEYS.admin);
  await admin.page.goto("/");
  await signInViaUi(admin.page);
  const ra = api(admin.page.request, baseURL!);
  const list = await (await admin.page.request.get("/api/admin/partner-services")).json();
  const topup = list.topups.find((x: { t: { referenceCode: string } }) => x.t.referenceCode === ref).t;
  // VAT-inclusive KRW amount locked into the request: total = supply + floor(supply × 10%).
  expect(Number(topup.krwTotal)).toBe(Number(topup.krwSupply) + Math.floor(Number(topup.krwSupply) / 10));
  expect((await ra.post(`/api/admin/partner-services/topups/${topup.id}`, { decision: "APPROVE" })).status()).toBe(200);

  // Partner issues an invoice; the public page shows the company account.
  const inv = await (await r.post("/api/partner/invoices", { issuerName: "E2E Studio", customerName: "Customer K", description: "10 promo clips", amountUsd: "40" })).json();
  const pub = await browser.newPage();
  await pub.goto(`/invoice/${inv.invoice.publicToken}`);
  await expect(pub.getByRole("heading", { name: "E2E Studio" })).toBeVisible();
  await expect(pub.getByText("$40.00 USD")).toBeVisible();
  await expect(pub.getByText("000-111-222")).toBeVisible();
  await expect(pub.getByText(inv.invoice.referenceCode)).toBeVisible();

  // Admin confirms the customer's payment → full amount owed to the partner.
  expect((await ra.post(`/api/admin/partner-services/invoices/${inv.invoice.id}/paid`, {})).status()).toBe(200);
  const summary = await (await page.request.get("/api/partner/services")).json();
  expect(summary.creditE8).toBe("5000000000");
  expect(summary.invoicePayableE8).toBe("4000000000");
  await pub.reload();
  await expect(pub.getByText("입금 확인")).toBeVisible();
  // Non-admins cannot confirm payments.
  expect((await r.post(`/api/admin/partner-services/invoices/${inv.invoice.id}/paid`, {})).status()).toBe(403);
  await pub.close();
  await admin.context.close();
  await ctx.close();
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
  await page.getByRole("button", { name: /전략 · 소스코드/ }).click();
  await page.getByRole("button", { name: "+ 소스코드 첨부" }).click();
  await page.getByLabel("코드 붙여넣기").fill(pine);
  const meta = page.getByTestId("pine-meta");
  await expect(meta.getByText("Pine v6")).toBeVisible();
  await expect(meta.getByText("indicator", { exact: true })).toBeVisible();
  await expect(meta.getByText("입력 12개")).toBeVisible();
  await expect(page.getByText(/indicator\(\) 스크립트는 신호만 만들고/)).toBeVisible();

  // Saved bot (via API with the same payload the wizard sends): owner sees the code, others don't.
  const slug = `src-${Date.now()}`;
  const res = await api(page.request, baseURL!).post("/api/bots", {
    ...botInput(slug),
    source: { language: "PINESCRIPT", visibility: "PRIVATE", code: pine },
  });
  expect(res.status()).toBe(201);
  await page.goto(`/bots/${slug}`);
  const panel = page.getByTestId("bot-source");
  await expect(panel.getByText("비공개")).toBeVisible();
  await panel.getByRole("button", { name: "코드 보기" }).click();
  await expect(panel.locator("pre")).toContainText("RSI DIV + LTF DELTA + EMA FILTER V11");
  const anon = await browser.newContext();
  expect((await anon.request.get(`/api/bots/${slug}`)).status()).toBe(404);
  await anon.close();
  await ctx.close();
});
