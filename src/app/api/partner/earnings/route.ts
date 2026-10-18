import { readContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { formatUsdcE8 } from "@/lib/money";
import { partnerEarnings, type EarningsFilter } from "@/lib/partner/queries";

function parseDate(v: string | null) {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function csvCell(v: string | number | null) {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const GET = handler(async (req: Request) => {
  const { db, user } = await readContext({ role: "PARTNER" });
  const p = new URL(req.url).searchParams;
  const tier = p.get("tier");
  const filter: EarningsFilter = {
    from: parseDate(p.get("from")),
    to: parseDate(p.get("to")),
    tier: tier === "1" ? 1 : tier === "2" ? 2 : undefined,
    botId: p.get("botId") || undefined,
  };
  const rows = await partnerEarnings(db, user.id, filter);
  if (p.get("format") === "csv") {
    const header = ["occurred_at", "tier", "bot", "trader", "builder_fee_usdc", "earned_usdc", "fee_policy_version"];
    const lines = rows.map((r) =>
      [r.occurredAt.toISOString(), r.tier, r.bot, r.trader, formatUsdcE8(r.builderFeeE8, 2), formatUsdcE8(r.earnedE8, 2), r.policyVersion]
        .map(csvCell)
        .join(","),
    );
    return new Response([header.join(","), ...lines].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ctc-partner-earnings.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  return json({ earnings: rows });
});
