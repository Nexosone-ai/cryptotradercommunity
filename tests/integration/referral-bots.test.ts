import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { bots, botSubscriptions, partners, referralRelations } from "@/lib/db/schema";
import { activatePartner, registerReferral, resolveBeneficiaries } from "@/lib/referral/service";
import {
  createBot,
  getBotForViewer,
  ownerSetStatus,
  reviewBot,
  submitBot,
  subscribe,
  unsubscribe,
  updateBot,
} from "@/lib/bots/service";
import { makeUser, rolesOf, testDb, validBotInput } from "../helpers/db";

describe("two-tier referrals", () => {
  let db: Db;
  beforeAll(async () => {
    db = await testDb();
  });

  it("A → B → C gives C: direct B, indirect A; D under A: direct A only", async () => {
    const A = await makeUser(db);
    const B = await makeUser(db);
    const C = await makeUser(db);
    const D = await makeUser(db);
    const pa = await activatePartner(db, A.id, A.walletAddress);
    expect(await registerReferral(db, B.id, pa.referralCode)).toMatchObject({ status: "REGISTERED", indirectPartnerUserId: null });
    const pb = await activatePartner(db, B.id, B.walletAddress);
    expect(await registerReferral(db, C.id, pb.referralCode)).toEqual({
      status: "REGISTERED",
      directPartnerUserId: B.id,
      indirectPartnerUserId: A.id,
    });
    expect(await registerReferral(db, D.id, pa.referralCode)).toMatchObject({ directPartnerUserId: A.id, indirectPartnerUserId: null });
    expect(await resolveBeneficiaries(db, C.id)).toEqual({ tier1: B.id, tier2: A.id });
    expect(await rolesOf(db, B.id)).toContain("PARTNER");
  });

  it("relations are frozen: a second code is ignored", async () => {
    const A = await makeUser(db);
    const X = await makeUser(db);
    const T = await makeUser(db);
    const pa = await activatePartner(db, A.id, A.walletAddress);
    const px = await activatePartner(db, X.id, X.walletAddress);
    await registerReferral(db, T.id, pa.referralCode);
    expect(await registerReferral(db, T.id, px.referralCode)).toEqual({ status: "IGNORED", reason: "ALREADY_REFERRED" });
    const [rel] = await db.select().from(referralRelations).where(eq(referralRelations.traderUserId, T.id));
    expect(rel.directPartnerUserId).toBe(A.id);
  });

  it("blocks self-referral and cycles", async () => {
    const A = await makeUser(db);
    const B = await makeUser(db);
    const pa = await activatePartner(db, A.id, A.walletAddress);
    expect(await registerReferral(db, A.id, pa.referralCode)).toEqual({ status: "IGNORED", reason: "SELF_REFERRAL" });
    await registerReferral(db, B.id, pa.referralCode);
    const pb = await activatePartner(db, B.id, B.walletAddress);
    // A trying to join under B (B is downstream of A) would close a loop.
    expect(await registerReferral(db, A.id, pb.referralCode)).toEqual({ status: "IGNORED", reason: "CYCLE" });
  });

  it("suspended partners do not receive tier shares", async () => {
    const A = await makeUser(db);
    const B = await makeUser(db);
    const C = await makeUser(db);
    const pa = await activatePartner(db, A.id, A.walletAddress);
    await registerReferral(db, B.id, pa.referralCode);
    const pb = await activatePartner(db, B.id, B.walletAddress);
    await registerReferral(db, C.id, pb.referralCode);
    await db.update(partners).set({ eligibilityStatus: "SUSPENDED" }).where(eq(partners.userId, A.id));
    expect(await resolveBeneficiaries(db, C.id)).toEqual({ tier1: B.id, tier2: null });
  });
});

describe("bot registration and review", () => {
  let db: Db;
  beforeAll(async () => {
    db = await testDb();
  });

  it("owner wallet is taken from the session, not the request body", async () => {
    const owner = await makeUser(db);
    const { bot } = await createBot(db, owner, { ...validBotInput(), ownerWalletAddress: "0x000000000000000000000000000000000000dEaD" });
    expect(bot.ownerWalletAddress).toBe(owner.walletAddress);
    expect(bot.status).toBe("DRAFT");
    expect(await rolesOf(db, owner.id)).toContain("BOT_OWNER");
  });

  it("another wallet cannot edit or submit the bot", async () => {
    const owner = await makeUser(db);
    const other = await makeUser(db);
    const input = validBotInput();
    const { bot } = await createBot(db, owner, input);
    await expect(updateBot(db, other, bot.id, { ...input, name: "Hijack" })).rejects.toThrow(/본인/);
    await expect(submitBot(db, other, bot.id)).rejects.toThrow(/본인/);
  });

  it("unreviewed bots are hidden from the public; live bots are visible", async () => {
    const owner = await makeUser(db);
    const admin = await makeUser(db, ["TRADER", "ADMIN"]);
    const visitor = await makeUser(db);
    const { bot } = await createBot(db, owner, validBotInput());
    expect(await getBotForViewer(db, bot.id, null)).toBeNull();
    await submitBot(db, owner, bot.id);
    expect(await getBotForViewer(db, bot.slug, visitor)).toBeNull();
    expect(await getBotForViewer(db, bot.id, owner)).not.toBeNull();
    await reviewBot(db, admin, bot.id, "APPROVE");
    expect(await getBotForViewer(db, bot.id, null)).toBeNull(); // approved but not yet live
    await ownerSetStatus(db, owner, bot.id, "LIVE");
    expect((await getBotForViewer(db, bot.slug, null))?.bot.status).toBe("LIVE");
  });

  it("admins cannot review their own bot; non-admins cannot review at all", async () => {
    const adminOwner = await makeUser(db, ["TRADER", "ADMIN"]);
    const trader = await makeUser(db);
    const { bot } = await createBot(db, adminOwner, validBotInput());
    await submitBot(db, adminOwner, bot.id);
    await expect(reviewBot(db, adminOwner, bot.id, "APPROVE")).rejects.toThrow(/이해충돌/);
    await expect(reviewBot(db, trader, bot.id, "APPROVE")).rejects.toThrow();
  });

  it("rejects fees above the platform cap and risky configs", async () => {
    const owner = await makeUser(db);
    await expect(createBot(db, owner, validBotInput({ feeTenthsBp: 90 }))).rejects.toThrow(/상한/);
    await expect(
      createBot(db, owner, validBotInput({ risk: { ...validBotInput().risk, emergencyStop: false } })),
    ).rejects.toThrow();
  });

  it("fee increase is not applied to existing subscribers without re-consent", async () => {
    const owner = await makeUser(db);
    const admin = await makeUser(db, ["TRADER", "ADMIN"]);
    const sub = await makeUser(db);
    const input = validBotInput({ feeTenthsBp: 20 });
    const { bot } = await createBot(db, owner, input);
    await submitBot(db, owner, bot.id);
    await reviewBot(db, admin, bot.id, "APPROVE");
    await ownerSetStatus(db, owner, bot.id, "LIVE");
    await subscribe(db, sub, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true });

    await updateBot(db, owner, bot.id, { ...input, feeTenthsBp: 40 });
    let [s] = await db.select().from(botSubscriptions).where(eq(botSubscriptions.userId, sub.id));
    expect(s.status).toBe("REQUIRES_RECONSENT");
    expect(s.acceptedFeeTenthsBp).toBe(20);
    expect(s.pendingFeeTenthsBp).toBe(40);

    // Stale consent at the old fee is refused; consent at the new fee works.
    await expect(subscribe(db, sub, bot.id, { acceptedFeeTenthsBp: 20, acceptRisk: true })).rejects.toThrow(/변경/);
    await subscribe(db, sub, bot.id, { acceptedFeeTenthsBp: 40, acceptRisk: true });
    [s] = await db.select().from(botSubscriptions).where(eq(botSubscriptions.userId, sub.id));
    expect(s).toMatchObject({ status: "ACTIVE", acceptedFeeTenthsBp: 40 });

    await unsubscribe(db, sub, bot.id);
    [s] = await db.select().from(botSubscriptions).where(eq(botSubscriptions.userId, sub.id));
    expect(s.status).toBe("STOPPED");
  });

  it("material change to a live bot sends it back to review", async () => {
    const owner = await makeUser(db);
    const admin = await makeUser(db, ["TRADER", "ADMIN"]);
    const input = validBotInput();
    const { bot } = await createBot(db, owner, input);
    await submitBot(db, owner, bot.id);
    await reviewBot(db, admin, bot.id, "APPROVE");
    await ownerSetStatus(db, owner, bot.id, "LIVE");
    const r = await updateBot(db, owner, bot.id, { ...input, risk: { ...input.risk, maxLeverage: 4 } });
    expect(r.bot.status).toBe("SUBMITTED");
    const [row] = await db.select().from(bots).where(eq(bots.id, bot.id));
    expect(row.configVersion).toBe(2);
  });

  it("owner cannot lift an admin suspension", async () => {
    const owner = await makeUser(db);
    const admin = await makeUser(db, ["TRADER", "ADMIN"]);
    const { bot } = await createBot(db, owner, validBotInput());
    await submitBot(db, owner, bot.id);
    await reviewBot(db, admin, bot.id, "APPROVE");
    await ownerSetStatus(db, owner, bot.id, "LIVE");
    await reviewBot(db, admin, bot.id, "SUSPEND", "risk breach");
    await expect(ownerSetStatus(db, owner, bot.id, "LIVE")).rejects.toThrow(/관리자/);
  });
});
