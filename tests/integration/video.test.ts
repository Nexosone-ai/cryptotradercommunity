import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { activatePartner } from "@/lib/referral/service";
import { reconcile } from "@/lib/ledger/service";
import { verifyAuditChain } from "@/lib/audit";
import { formatUsdcE8 } from "@/lib/money";
import type { FalGateway } from "@/lib/video/fal";
import { parsePlanForTests } from "@/lib/video/fal";
import { quoteVideoJob, usdToE8 } from "@/lib/video/models";
import {
  cancelInvoice,
  createInvoice,
  createVideoJob,
  creditBalance,
  getJob,
  invoicePayable,
  markInvoicePaid,
  refreshJob,
  requestTopup,
  reviewTopup,
  settlePartner,
  syncOutputByRequestId,
} from "@/lib/video/service";
import type { FxProvider } from "@/lib/fx";
import { makeUser, testDb, type TestUser } from "../helpers/db";

// Fixed rate so KRW prices are deterministic: $1 = ₩1,325.5
const FX: FxProvider = { usdKrw: async () => ({ rate: "1325.5", source: "test", asOf: new Date("2026-10-27T02:00:00Z") }) };

const ENV = {
  FAL_KEY: "test-key",
  COMPANY_NAME: "Test Co",
  COMPANY_BANK_NAME: "Test Bank",
  COMPANY_BANK_ACCOUNT: "000-000",
  COMPANY_BANK_HOLDER: "Test Co",
};
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const APP = new URL("http://localhost:3000");
const SRC = "https://v3.fal.media/files/test/source.mp4";

let requestSeq = 0; // unique across fakes, like real fal request ids

function fakeFal(opts: { failPlan?: boolean; failSubmitAt?: number[] } = {}) {
  const results = new Map<string, Awaited<ReturnType<FalGateway["videoResult"]>>>();
  let n = 0;
  const gw: FalGateway & { results: typeof results; submitted: string[] } = {
    results,
    submitted: [],
    initiateUpload: async () => ({ uploadUrl: "https://upload.example/put", fileUrl: SRC }),
    extractFrame: async () => "https://v3.fal.media/files/test/frame.png",
    planVariations: async (_img, _brief, count) => {
      if (opts.failPlan) throw new Error("vision down");
      return { description: "a city at night", prompts: Array.from({ length: count }, (_, i) => `variation ${i}`) };
    },
    submitVideo: async () => {
      const i = n++;
      if (opts.failSubmitAt?.includes(i)) throw new Error("queue full");
      const id = `req-${requestSeq++}`;
      gw.submitted.push(id);
      results.set(id, { status: "IN_QUEUE" });
      return id;
    },
    videoResult: async (id) => results.get(id) ?? { status: "FAILED", error: "unknown" },
  };
  return gw;
}

async function fundedPartner(db: Db, admin: TestUser, usd = 100) {
  const p = await makeUser(db, ["TRADER", "PARTNER"]);
  await activatePartner(db, p.id, p.walletAddress);
  const { topup } = await requestTopup(db, FX, p, usd);
  await reviewTopup(db, admin, topup.id, "APPROVE");
  return p;
}

describe("pricing", () => {
  it("charges cost × 1.4, split so each clip can be refunded exactly", () => {
    const q = quoteVideoJob("480P", 5);
    // cost: $0.02 analysis + 10 × 5s × $0.05 = $2.52 → price $3.528
    expect(formatUsdcE8(q.costE8)).toBe("2.52");
    expect(formatUsdcE8(q.priceE8)).toBe("3.528");
    expect(q.priceE8).toBe(q.analysisPriceE8 + q.clipPriceE8 * 10n);
    expect(formatUsdcE8(quoteVideoJob("768P", 10).priceE8)).toBe("11.228"); // (0.02 + 8.00) × 1.4
    expect(() => quoteVideoJob("480P", 7)).toThrow();
    expect(usdToE8("12.5")).toBe(1_250_000_000n);
    expect(() => usdToE8("1.234")).toThrow();
  });

  it("parses the vision model plan and rejects short answers", () => {
    const text = 'Sure! {"description":"d","prompts":["a","b","c"]}';
    expect(parsePlanForTests(text, 3).prompts).toEqual(["a", "b", "c"]);
    expect(() => parsePlanForTests(text, 10)).toThrow();
  });
});

describe("partner video service", () => {
  let db: Db;
  let admin: TestUser;
  beforeEach(async () => {
    db = await testDb();
    admin = await makeUser(db, ["TRADER", "ADMIN"]);
  });

  it("bank top-up is credited only after admin approval; non-partners cannot request", async () => {
    const outsider = await makeUser(db);
    await expect(requestTopup(db, FX, outsider, 50)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const p = await makeUser(db, ["TRADER", "PARTNER"]);
    await activatePartner(db, p.id, p.walletAddress);
    await expect(requestTopup(db, FX, p, 77)).rejects.toMatchObject({ code: "INVALID_PACKAGE" });
    const { topup, bank } = await requestTopup(db, FX, p, 50);
    expect(topup.referenceCode).toMatch(/^TOP-/);
    // $50 × 1,325.5 = ₩66,275 supply + ₩6,627 VAT = ₩72,902, locked into the request
    expect(topup).toMatchObject({ fxRate: "1325.5", krwSupply: 66_275n, krwVat: 6_627n, krwTotal: 72_902n });
    expect(bank.bankAccount).toBe("000-000");
    expect(await creditBalance(db, p.id)).toBe(0n);
    await expect(reviewTopup(db, p, topup.id, "APPROVE")).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Admin confirms the amount actually received.
    await reviewTopup(db, admin, topup.id, "APPROVE", usdToE8("49.5"));
    expect(formatUsdcE8(await creditBalance(db, p.id))).toBe("49.50");
    await expect(reviewTopup(db, admin, topup.id, "APPROVE")).rejects.toMatchObject({ code: "TOPUP_NOT_PENDING" });
  });

  it("charges credit, queues 10 clips, completes from fal results", async () => {
    const p = await fundedPartner(db, admin);
    const fal = fakeFal();
    const before = await creditBalance(db, p.id);
    const { job, outputs } = await createVideoJob(db, fal, p, { sourceVideoUrl: SRC, resolution: "480P", clipSeconds: 5, rightsConfirmed: true }, APP);
    expect(job.status).toBe("GENERATING");
    expect(outputs).toHaveLength(10);
    expect(fal.submitted).toHaveLength(10);
    expect(before - (await creditBalance(db, p.id))).toBe(job.priceE8);

    for (const id of fal.submitted) fal.results.set(id, { status: "COMPLETED", videoUrl: `https://v3.fal.media/out/${id}.mp4` });
    for (const id of fal.submitted) await syncOutputByRequestId(db, fal, id);
    await syncOutputByRequestId(db, fal, fal.submitted[0]); // duplicate webhook: no change
    const done = await getJob(db, p, job.id);
    expect(done.job.status).toBe("COMPLETED");
    expect(done.outputs.every((o) => o.videoUrl)).toBe(true);
    expect((await reconcile(db)).issues).toEqual([]);
  });

  it("refunds exactly the failed clips, once", async () => {
    const p = await fundedPartner(db, admin);
    const fal = fakeFal({ failSubmitAt: [3] });
    const start = await creditBalance(db, p.id);
    const { job } = await createVideoJob(db, fal, p, { sourceVideoUrl: SRC, resolution: "768P", clipSeconds: 5, rightsConfirmed: true }, APP);
    fal.results.set(fal.submitted[0], { status: "FAILED", error: "safety checker" });
    for (const id of fal.submitted.slice(1)) fal.results.set(id, { status: "COMPLETED", videoUrl: `https://x/${id}.mp4` });
    await refreshJob(db, fal, job.id);
    await syncOutputByRequestId(db, fal, fal.submitted[0]);
    const after = await getJob(db, p, job.id);
    expect(after.job.status).toBe("PARTIAL");
    expect(after.job.refundedE8).toBe(job.clipPriceE8 * 2n);
    expect(start - (await creditBalance(db, p.id))).toBe(job.priceE8 - job.clipPriceE8 * 2n);
  });

  it("refunds everything if analysis fails, and refuses without enough credit or rights consent", async () => {
    const p = await fundedPartner(db, admin, 50);
    const input = { sourceVideoUrl: SRC, resolution: "480P" as const, clipSeconds: 5, rightsConfirmed: true };
    await expect(createVideoJob(db, fakeFal({ failPlan: true }), p, input, APP)).rejects.toMatchObject({ code: "ANALYSIS_FAILED" });
    expect(formatUsdcE8(await creditBalance(db, p.id))).toBe("50.00");
    await expect(createVideoJob(db, fakeFal(), p, { ...input, rightsConfirmed: false }, APP)).rejects.toMatchObject({ code: "RIGHTS_REQUIRED" });
    await expect(createVideoJob(db, fakeFal(), p, { ...input, sourceVideoUrl: "https://evil.example/x.mp4" }, APP)).rejects.toMatchObject({
      code: "INVALID_SOURCE",
    });
    // Spend down to below one 768p·10s job ($11.228)
    for (let i = 0; i < 4; i++) await createVideoJob(db, fakeFal(), p, { ...input, resolution: "768P", clipSeconds: 10 }, APP);
    await expect(createVideoJob(db, fakeFal(), p, { ...input, resolution: "768P", clipSeconds: 10 }, APP)).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDIT",
    });
  });

  it("refuses to quote or request packages when no exchange rate is available", async () => {
    const p = await makeUser(db, ["TRADER", "PARTNER"]);
    await activatePartner(db, p.id, p.walletAddress);
    const down: FxProvider = { usdKrw: async () => { throw new Error("all sources down"); } };
    await expect(requestTopup(db, down, p, 50)).rejects.toMatchObject({ code: "FX_UNAVAILABLE" });
  });

  it("other partners cannot see a job", async () => {
    const p = await fundedPartner(db, admin);
    const other = await fundedPartner(db, admin);
    const { job } = await createVideoJob(db, fakeFal(), p, { sourceVideoUrl: SRC, resolution: "480P", clipSeconds: 5, rightsConfirmed: true }, APP);
    await expect(getJob(db, other, job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("customer invoice: partner price ≥ platform price, paid into company, full amount owed to partner, settled once", async () => {
    const p = await fundedPartner(db, admin);
    const { job } = await createVideoJob(db, fakeFal(), p, { sourceVideoUrl: SRC, resolution: "480P", clipSeconds: 5, rightsConfirmed: true }, APP);
    const base = { issuerName: "Studio P", customerName: "Customer C", description: "10 promo clips" };
    await expect(createInvoice(db, p, { ...base, amountE8: usdToE8("1"), jobId: job.id })).rejects.toMatchObject({ code: "BELOW_PLATFORM_PRICE" });
    const inv = await createInvoice(db, p, { ...base, amountE8: usdToE8("30"), jobId: job.id });
    expect(inv.referenceCode).toMatch(/^INV-/);
    expect(inv.publicToken.length).toBeGreaterThan(20);

    await expect(markInvoicePaid(db, p, inv.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await markInvoicePaid(db, admin, inv.id, "bank deposit 10/27");
    await expect(markInvoicePaid(db, admin, inv.id)).rejects.toMatchObject({ code: "INVOICE_NOT_ISSUED" });
    expect(formatUsdcE8(await invoicePayable(db, p.id))).toBe("30.00");

    await expect(settlePartner(db, admin, p.id, usdToE8("31"), "wire #1")).rejects.toMatchObject({ code: "EXCEEDS_PAYABLE" });
    await settlePartner(db, admin, p.id, usdToE8("30"), "wire #1");
    expect(await invoicePayable(db, p.id)).toBe(0n);

    const inv2 = await createInvoice(db, p, { ...base, amountE8: usdToE8("5") });
    await cancelInvoice(db, p, inv2.id);
    await expect(markInvoicePaid(db, admin, inv2.id)).rejects.toMatchObject({ code: "INVOICE_NOT_ISSUED" });

    expect((await reconcile(db)).issues).toEqual([]);
    expect(await verifyAuditChain(db)).toBeNull();
  });

  it("invoices and top-ups are refused until the company account is configured", async () => {
    const p = await fundedPartner(db, admin);
    const acct = process.env.COMPANY_BANK_ACCOUNT;
    delete process.env.COMPANY_BANK_ACCOUNT;
    try {
      await expect(requestTopup(db, FX, p, 50)).rejects.toMatchObject({ code: "COMPANY_BANK_NOT_CONFIGURED" });
      await expect(createInvoice(db, p, { issuerName: "a", customerName: "b", description: "c", amountE8: 1n })).rejects.toMatchObject({
        code: "COMPANY_BANK_NOT_CONFIGURED",
      });
    } finally {
      process.env.COMPANY_BANK_ACCOUNT = acct;
    }
  });
});
