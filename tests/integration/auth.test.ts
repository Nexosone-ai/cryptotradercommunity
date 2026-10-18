import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Db } from "@/lib/db/client";
import { issueSiweMessage } from "@/lib/auth/siwe";
import { signIn } from "@/lib/auth/service";
import { loadSessionUser, revokeSession } from "@/lib/auth/session";
import { activatePartner } from "@/lib/referral/service";
import { verifyAuditChain } from "@/lib/audit";
import { testDb } from "../helpers/db";

const DOMAIN = "localhost:3000";
const SEPOLIA = 11155111;
const URI = "http://localhost:3000";

async function login(db: Db, pk: `0x${string}`, opts: { acceptTerms?: boolean; referralCode?: string; chainId?: number } = {}) {
  const account = privateKeyToAccount(pk);
  const { message } = await issueSiweMessage(db, { address: account.address, chainId: opts.chainId ?? SEPOLIA, domain: DOMAIN, uri: URI });
  const signature = await account.signMessage({ message });
  return { message, signature, result: signIn(db, { message, signature, expectedDomain: DOMAIN, acceptTerms: opts.acceptTerms ?? true, referralCode: opts.referralCode }) };
}

describe("MetaMask (SIWE) sign-in", () => {
  let db: Db;
  beforeAll(async () => {
    db = await testDb();
  });

  it("signs in with a valid signature and creates a session", async () => {
    const pk = generatePrivateKey();
    const { result } = await login(db, pk);
    const r = await result;
    expect(r.isNew).toBe(true);
    const user = await loadSessionUser(db, r.session.token);
    expect(user?.walletAddress).toBe(privateKeyToAccount(pk).address.toLowerCase());
    expect(user?.roles).toContain("TRADER");
    expect(user?.roles).not.toContain("ADMIN");
  });

  it("rejects a replayed nonce", async () => {
    const pk = generatePrivateKey();
    const { message, signature, result } = await login(db, pk);
    await result;
    await expect(signIn(db, { message, signature, expectedDomain: DOMAIN, acceptTerms: true })).rejects.toThrow(/만료|사용/);
  });

  it("rejects a wrong domain", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { message } = await issueSiweMessage(db, { address: account.address, chainId: SEPOLIA, domain: "evil.example", uri: "https://evil.example" });
    const signature = await account.signMessage({ message });
    await expect(signIn(db, { message, signature, expectedDomain: DOMAIN, acceptTerms: true })).rejects.toThrow(/도메인/);
  });

  it("rejects a signature from a different wallet", async () => {
    const victim = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const { message } = await issueSiweMessage(db, { address: victim.address, chainId: SEPOLIA, domain: DOMAIN, uri: URI });
    const signature = await attacker.signMessage({ message });
    await expect(signIn(db, { message, signature, expectedDomain: DOMAIN, acceptTerms: true })).rejects.toThrow(/서명 검증/);
  });

  it("rejects a tampered message (chain id swapped)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { message } = await issueSiweMessage(db, { address: account.address, chainId: SEPOLIA, domain: DOMAIN, uri: URI });
    const tampered = message.replace(`Chain ID: ${SEPOLIA}`, "Chain ID: 42161");
    const signature = await account.signMessage({ message: tampered });
    await expect(signIn(db, { message: tampered, signature, expectedDomain: DOMAIN, acceptTerms: true })).rejects.toThrow();
  });

  it("issues login messages only for the configured wallet chain (testnet: Ethereum Sepolia)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await expect(issueSiweMessage(db, { address: account.address, chainId: 1, domain: DOMAIN, uri: URI })).rejects.toMatchObject({
      code: "WRONG_CHAIN",
    });
    const { message } = await issueSiweMessage(db, { address: account.address, chainId: SEPOLIA, domain: DOMAIN, uri: URI });
    expect(message).toContain("Chain ID: 11155111");
  });

  it("rejects an expired nonce", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const { message } = await issueSiweMessage(db, { address: account.address, chainId: SEPOLIA, domain: DOMAIN, uri: URI }, past);
    const signature = await account.signMessage({ message });
    await expect(signIn(db, { message, signature, expectedDomain: DOMAIN, acceptTerms: true })).rejects.toThrow(/만료/);
  });

  it("requires terms consent on first sign-in", async () => {
    const { result } = await login(db, generatePrivateKey(), { acceptTerms: false });
    await expect(result).rejects.toThrow(/동의/);
  });

  it("logout revokes the session", async () => {
    const r = await (await login(db, generatePrivateKey())).result;
    await revokeSession(db, r.session.token);
    expect(await loadSessionUser(db, r.session.token)).toBeNull();
  });

  it("bootstraps ADMIN from ADMIN_WALLET_ADDRESS with an audit record", async () => {
    const pk = generatePrivateKey();
    process.env.ADMIN_WALLET_ADDRESS = privateKeyToAccount(pk).address;
    try {
      const r = await (await login(db, pk)).result;
      const user = await loadSessionUser(db, r.session.token);
      expect(user?.roles).toContain("ADMIN");
      expect(await verifyAuditChain(db)).toBeNull();
    } finally {
      delete process.env.ADMIN_WALLET_ADDRESS;
    }
  });

  it("registers the referral relation on first sign-in only", async () => {
    const partnerPk = generatePrivateKey();
    const p = await (await login(db, partnerPk)).result;
    const partner = await activatePartner(db, p.user.id, p.user.walletAddress);
    const r = await (await login(db, generatePrivateKey(), { referralCode: partner.referralCode })).result;
    expect(r.referral).toMatchObject({ status: "REGISTERED", directPartnerUserId: p.user.id });
    // Existing user signing in again with a code: no change.
    const again = await (await login(db, partnerPk, { referralCode: partner.referralCode })).result;
    expect(again.referral).toBeNull();
  });
});
