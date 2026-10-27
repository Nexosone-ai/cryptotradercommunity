import { describe, expect, it } from "vitest";
import { createFxProvider, fromKoreaExim, krwWithVat } from "@/lib/fx";

type Resp = { ok: boolean; json(): Promise<unknown> };
const ok = (body: unknown): Resp => ({ ok: true, json: async () => body });

describe("USD/KRW rate", () => {
  it("parses the Korea Eximbank rate and skips non-business days", async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      return calls.length < 3 ? ok([]) : ok([{ result: 1, cur_unit: "JPY(100)", deal_bas_r: "905.1" }, { result: 1, cur_unit: "USD", deal_bas_r: "1,325.5" }]);
    };
    const q = await fromKoreaExim(fetchFn, "key", new Date("2026-10-26T03:00:00Z"));
    expect(q).toMatchObject({ rate: "1325.5", source: "한국수출입은행 매매기준율" });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("searchdate=20261026");
    expect(calls[2]).toContain("searchdate=20261024");
  });

  it("falls back to free sources, rejects implausible rates and fails closed", async () => {
    process.env.KOREAEXIM_API_KEY = "key";
    try {
      const fx = createFxProvider(async (url) => {
        if (url.includes("koreaexim")) return { ok: false, json: async () => null };
        if (url.includes("open.er-api")) return ok({ result: "success", rates: { KRW: 1325.18618 }, time_last_update_unix: 1792800000 });
        throw new Error("unexpected");
      });
      expect(await fx.usdKrw()).toMatchObject({ rate: "1325.1862", source: "open.er-api.com" });
      const weird = createFxProvider(async (url) =>
        url.includes("open.er-api") ? ok({ result: "success", rates: { KRW: 13.25 } }) : ok({ date: "2026-10-26", rates: { KRW: 1325.28 } }),
      );
      expect((await weird.usdKrw()).source).toBe("Frankfurter (ECB)");
      const down = createFxProvider(async () => ({ ok: false, json: async () => null }));
      await expect(down.usdKrw()).rejects.toThrow(/No exchange rate/);
    } finally {
      delete process.env.KOREAEXIM_API_KEY;
    }
  });

  it("prices KRW with 10% VAT: supply rounded up, VAT rounded down", () => {
    expect(krwWithVat(50, "1325.5")).toEqual({ supply: 66_275n, vat: 6_627n, total: 72_902n });
    expect(krwWithVat(100, "1325.18618")).toEqual({ supply: 132_519n, vat: 13_251n, total: 145_770n });
  });
});
