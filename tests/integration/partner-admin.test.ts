import { beforeAll, describe, expect, it } from "vitest";
import { getAddress } from "viem";
import type { Db } from "@/lib/db/client";
import { grantPartner, listPartners, setPartnerStatus } from "@/lib/referral/admin";
import { resolveBeneficiaries, registerReferral } from "@/lib/referral/service";
import { makeUser, rolesOf, testDb } from "../helpers/db";

describe("admin-appointed referral partners", () => {
  let db: Db;
  beforeAll(async () => {
    db = await testDb();
  });

  it("an admin appoints a signed-in wallet (any address case); repeat grants are idempotent", async () => {
    const admin = await makeUser(db, ["ADMIN"]);
    const p = await makeUser(db);
    const partner = await grantPartner(db, admin, getAddress(p.walletAddress));
    expect(partner.eligibilityStatus).toBe("ACTIVE");
    expect(await rolesOf(db, p.id)).toContain("PARTNER");
    expect((await grantPartner(db, admin, p.walletAddress)).id).toBe(partner.id);
    const row = (await listPartners(db)).find((x) => x.id === partner.id);
    expect(row).toMatchObject({ wallet: p.walletAddress, referralCode: partner.referralCode, direct: 0, indirect: 0 });
  });

  it("refuses invalid addresses and wallets that never signed in", async () => {
    const admin = await makeUser(db, ["ADMIN"]);
    await expect(grantPartner(db, admin, "not-an-address")).rejects.toMatchObject({ status: 400, code: "INVALID_ADDRESS" });
    await expect(grantPartner(db, admin, "0x00000000000000000000000000000000000000aa")).rejects.toMatchObject({ status: 404 });
  });

  it("a suspended partner earns no tier share until reactivated", async () => {
    const admin = await makeUser(db, ["ADMIN"]);
    const p = await makeUser(db);
    const trader = await makeUser(db);
    const partner = await grantPartner(db, admin, p.walletAddress);
    await registerReferral(db, trader.id, partner.referralCode);
    expect((await listPartners(db)).find((x) => x.id === partner.id)?.direct).toBe(1);
    await setPartnerStatus(db, admin, partner.id, "SUSPENDED");
    expect((await resolveBeneficiaries(db, trader.id)).tier1).toBeNull();
    await setPartnerStatus(db, admin, partner.id, "ACTIVE");
    expect((await resolveBeneficiaries(db, trader.id)).tier1).toBe(p.id);
  });
});
