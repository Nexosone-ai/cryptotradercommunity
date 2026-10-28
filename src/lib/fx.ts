import Decimal from "decimal.js";
import { bi } from "./i18n";

/**
 * USD → KRW exchange rate for pricing credit packages.
 *
 * Sources, in order:
 *  1. Korea Eximbank Open API 매매기준율 (official; needs KOREAEXIM_API_KEY).
 *     Empty on weekends/holidays and before ~11:00 KST, so earlier days are tried.
 *  2. open.er-api.com (free, daily).
 *  3. Frankfurter / ECB reference rate (free, business days).
 * A rate outside a plausible band is rejected. If every source fails, callers
 * must not quote a price (fail closed).
 */
export interface FxQuote {
  /** KRW per 1 USD, decimal string. */
  rate: string;
  source: string;
  /** When the source published the rate. */
  asOf: Date;
}

export interface FxProvider {
  usdKrw(): Promise<FxQuote>;
}

const MIN_RATE = 500;
const MAX_RATE = 3000;
const CACHE_MS = 30 * 60 * 1000;

function plausible(rate: Decimal) {
  return rate.isFinite() && rate.gte(MIN_RATE) && rate.lte(MAX_RATE);
}

type Fetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function ymd(d: Date) {
  const kst = new Date(d.getTime() + 9 * 3600_000);
  return kst.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function fromKoreaExim(fetchFn: Fetch, key: string, now = new Date()): Promise<FxQuote> {
  for (let back = 0; back < 7; back++) {
    const day = new Date(now.getTime() - back * 86_400_000);
    const url = `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${encodeURIComponent(key)}&searchdate=${ymd(day)}&data=AP01`;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`koreaexim HTTP error`);
    const rows = (await res.json()) as { result?: number; cur_unit?: string; deal_bas_r?: string }[];
    if (!Array.isArray(rows) || rows.length === 0) continue; // non-business day / before publication
    if (rows[0]?.result !== undefined && rows[0].result !== 1) throw new Error(`koreaexim result ${rows[0].result}`);
    const usd = rows.find((r) => r.cur_unit === "USD");
    if (!usd?.deal_bas_r) continue;
    const rate = new Decimal(usd.deal_bas_r.replace(/,/g, ""));
    if (!plausible(rate)) throw new Error("koreaexim rate out of range");
    const publishedAt = new Date(`${ymd(day).slice(0, 4)}-${ymd(day).slice(4, 6)}-${ymd(day).slice(6)}T11:00:00+09:00`);
    return { rate: rate.toFixed(), source: bi("Export-Import Bank of Korea base rate", "한국수출입은행 매매기준율"), asOf: publishedAt };
  }
  throw new Error("koreaexim: no rate in the last 7 days");
}

export async function fromOpenErApi(fetchFn: Fetch): Promise<FxQuote> {
  const res = await fetchFn("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) throw new Error("open.er-api HTTP error");
  const j = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_unix?: number };
  const krw = j.rates?.KRW;
  if (j.result !== "success" || typeof krw !== "number") throw new Error("open.er-api bad response");
  const rate = new Decimal(krw).toDecimalPlaces(4);
  if (!plausible(rate)) throw new Error("open.er-api rate out of range");
  return { rate: rate.toFixed(), source: "open.er-api.com", asOf: new Date((j.time_last_update_unix ?? 0) * 1000) };
}

export async function fromFrankfurter(fetchFn: Fetch): Promise<FxQuote> {
  const res = await fetchFn("https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW");
  if (!res.ok) throw new Error("frankfurter HTTP error");
  const j = (await res.json()) as { date?: string; rates?: Record<string, number> };
  const krw = j.rates?.KRW;
  if (typeof krw !== "number" || !j.date) throw new Error("frankfurter bad response");
  const rate = new Decimal(krw).toDecimalPlaces(4);
  if (!plausible(rate)) throw new Error("frankfurter rate out of range");
  return { rate: rate.toFixed(), source: "Frankfurter (ECB)", asOf: new Date(`${j.date}T16:00:00Z`) };
}

export function createFxProvider(fetchFn: Fetch = (u) => fetch(u, { signal: AbortSignal.timeout(8000) })): FxProvider {
  let cached: { at: number; quote: FxQuote } | null = null;
  return {
    async usdKrw() {
      if (cached && Date.now() - cached.at < CACHE_MS) return cached.quote;
      const key = process.env.KOREAEXIM_API_KEY;
      const sources: (() => Promise<FxQuote>)[] = [
        ...(key ? [() => fromKoreaExim(fetchFn, key)] : []),
        () => fromOpenErApi(fetchFn),
        () => fromFrankfurter(fetchFn),
      ];
      const errors: string[] = [];
      for (const s of sources) {
        try {
          const quote = await s();
          cached = { at: Date.now(), quote };
          return quote;
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      throw new Error(`No exchange rate available: ${errors.join("; ")}`);
    },
  };
}

let shared: FxProvider | undefined;
export function getFxProvider(): FxProvider {
  return (shared ??= createFxProvider());
}

/** VAT (부가가치세) rate for KRW prices. */
export const VAT_RATE = new Decimal("0.1");

export interface KrwPrice {
  /** 공급가액: ceil(USD × rate), whole won. */
  supply: bigint;
  /** 부가세: floor(공급가액 × 10%), whole won. */
  vat: bigint;
  /** 합계 (VAT 포함). */
  total: bigint;
}

export function krwWithVat(usd: Decimal.Value, rate: string): KrwPrice {
  const supply = new Decimal(usd).mul(rate).toDecimalPlaces(0, Decimal.ROUND_CEIL);
  const vat = supply.mul(VAT_RATE).toDecimalPlaces(0, Decimal.ROUND_FLOOR);
  return { supply: BigInt(supply.toFixed()), vat: BigInt(vat.toFixed()), total: BigInt(supply.plus(vat).toFixed()) };
}
