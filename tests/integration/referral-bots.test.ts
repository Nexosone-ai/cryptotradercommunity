import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { bots, botSubscriptions, partners, referralRelations } from "@/lib/db/schema";
import {
  activatePartner,
  joinAsAffiliate,
  registerReferral,
  resolveBeneficiaries,
  setAffiliateStatus,
  setWholesalerPortion,
} from "@/lib/referral/service";
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

describe("wholesale partners and one level of affiliates", () => {
  let db: Db;
  beforeAll(async () => {
    db = await testDb();
  });
  const POOL = 210_000; // 21% partner share under the 70 / 9 / 21 policy

  async function wholesaler(portionPpm: number | null = 100_000) {
    const W = await makeUser(db);
    await activatePartner(db, W.id, W.walletAddress, "admin-test");
    if (portionPpm !== null) await setWholesalerPortion(db, W, portionPpm, POOL);
    const [pw] = await db.select().from(partners).where(eq(partners.userId, W.id));
    return { W, pw };
  }

  it("an affiliate's client: direct = affiliate, indirect = wholesaler; the wholesaler's own client: direct only", async () => {
    const { W, pw } = await wholesaler(100_000);
    expect(pw).toMatchObject({ kind: "WHOLESALE", wholesalerPortionPpm: 100_000 });
    const A = await makeUser(db);
    const pa = await joinAsAffiliate(db, A, pw.affiliateInviteCode!);
    expect(pa).toMatchObject({ kind: "AFFILIATE", wholesalerUserId: W.id, affiliateInviteCode: null });
    expect(await rolesOf(db, A.id)).toContain("PARTNER");

    const C1 = await makeUser(db);
    const C2 = await makeUser(db);
    expect(await registerReferral(db, C1.id, pa.referralCode)).toEqual({ status: "REGISTERED", directPartnerUserId: A.id, indirectPartnerUserId: W.id });
    expect(await registerReferral(db, C2.id, pw.referralCode)).toEqual({ status: "REGISTERED", directPartnerUserId: W.id, indirectPartnerUserId: null });
    expect(await resolveBeneficiaries(db, C1.id)).toEqual({ tier1: A.id, tier2: W.id, wholesalerPortionPpm: 100_000 });
    expect(await resolveBeneficiaries(db, C2.id)).toEqual({ tier1: null, tier2: W.id, wholesalerPortionPpm: 100_000 });
    expect(await resolveBeneficiaries(db, (await makeUser(db)).id)).toEqual({ tier1: null, tier2: null, wholesalerPortionPpm: 0 });
  });

  it("only wholesale partners recruit: affiliates have no invite link and can't set a portion", async () => {
    const { pw } = await wholesaler();
    const A = await makeUser(db);
    const pa = await joinAsAffiliate(db, A, pw.affiliateInviteCode!);
    const B = await makeUser(db);
    await expect(joinAsAffiliate(db, B, pa.referralCode)).rejects.toMatchObject({ status: 404 });
    await expect(setWholesalerPortion(db, A, 50_000, POOL)).rejects.toMatchObject({ status: 403 });
    // A client of the affiliate doesn't become a partner and adds no level.
    const C = await makeUser(db);
    await registerReferral(db, C.id, pa.referralCode);
    const [rowC] = await db.select().from(partners).where(eq(partners.userId, C.id));
    expect(rowC).toBeUndefined();
  });

  it("joining needs a set-up program, another wallet and no existing partnership; the portion is capped by the partner share", async () => {
    const { W, pw } = await wholesaler(null);
    const A = await makeUser(db);
    await expect(joinAsAffiliate(db, A, pw.affiliateInviteCode!)).rejects.toMatchObject({ code: "PROGRAM_NOT_READY" });
    await expect(setWholesalerPortion(db, W, 220_000, POOL)).rejects.toMatchObject({ code: "PORTION_OUT_OF_RANGE" });
    await setWholesalerPortion(db, W, 210_000, POOL);
    await expect(joinAsAffiliate(db, W, pw.affiliateInviteCode!)).rejects.toMatchObject({ code: "SELF_INVITE" });
    await joinAsAffiliate(db, A, pw.affiliateInviteCode!);
    await expect(joinAsAffiliate(db, A, pw.affiliateInviteCode!)).rejects.toMatchObject({ code: "ALREADY_PARTNER" });
    const { W: other } = await wholesaler();
    const [po] = await db.select().from(partners).where(eq(partners.userId, other.id));
    await expect(joinAsAffiliate(db, other, pw.affiliateInviteCode!)).rejects.toMatchObject({ code: "ALREADY_PARTNER" });
    expect(po.kind).toBe("WHOLESALE");
  });

  it("relations are frozen: a second code is ignored", async () => {
    const { pw } = await wholesaler();
    const { pw: px } = await wholesaler();
    const T = await makeUser(db);
    await registerReferral(db, T.id, pw.referralCode);
    expect(await registerReferral(db, T.id, px.referralCode)).toEqual({ status: "IGNORED", reason: "ALREADY_REFERRED" });
    const [rel] = await db.select().from(referralRelations).where(eq(referralRelations.traderUserId, T.id));
    expect(rel.directPartnerUserId).toBe(pw.userId);
  });

  it("blocks self-referral and a wholesaler joining as their own affiliate's client", async () => {
    const { W, pw } = await wholesaler();
    expect(await registerReferral(db, W.id, pw.referralCode)).toEqual({ status: "IGNORED", reason: "SELF_REFERRAL" });
    const A = await makeUser(db);
    const pa = await joinAsAffiliate(db, A, pw.affiliateInviteCode!);
    expect(await registerReferral(db, W.id, pa.referralCode)).toEqual({ status: "IGNORED", reason: "CYCLE" });
  });

  it("a suspended wholesaler or affiliate gets no share", async () => {
    const { W, pw } = await wholesaler(80_000);
    const A = await makeUser(db);
    const pa = await joinAsAffiliate(db, A, pw.affiliateInviteCode!);
    const C = await makeUser(db);
    await registerReferral(db, C.id, pa.referralCode);
    await setAffiliateStatus(db, W, pa.id, "SUSPENDED");
    expect(await resolveBeneficiaries(db, C.id)).toEqual({ tier1: null, tier2: W.id, wholesalerPortionPpm: 80_000 });
    await setAffiliateStatus(db, W, pa.id, "ACTIVE");
    await db.update(partners).set({ eligibilityStatus: "SUSPENDED" }).where(eq(partners.userId, W.id));
    expect(await resolveBeneficiaries(db, C.id)).toEqual({ tier1: A.id, tier2: null, wholesalerPortionPpm: 80_000 });
    // A wholesaler can only manage their own affiliates.
    const { W: other } = await wholesaler();
    await expect(setAffiliateStatus(db, other, pa.id, "SUSPENDED")).rejects.toMatchObject({ status: 404 });
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
