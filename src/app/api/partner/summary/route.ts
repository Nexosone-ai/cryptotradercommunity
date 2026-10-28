import { readContext } from "@/lib/api";
import { handler, json, notFound } from "@/lib/http";
import { partnerSummary } from "@/lib/partner/queries";
import { bi } from "@/lib/i18n";

export const GET = handler(async () => {
  const { db, user, cfg } = await readContext({ role: "PARTNER" });
  const s = await partnerSummary(db, user.id);
  if (!s) throw notFound(bi("No partner information found.", "파트너 정보가 없습니다."));
  return json({ ...s, referralUrl: new URL(`/ref/${s.partner.referralCode}`, cfg.appUrl).toString() });
});
