import { readContext } from "@/lib/api";
import { handler, json, notFound } from "@/lib/http";
import { partnerSummary } from "@/lib/partner/queries";

export const GET = handler(async () => {
  const { db, user, cfg } = await readContext({ role: "PARTNER" });
  const s = await partnerSummary(db, user.id);
  if (!s) throw notFound("파트너 정보가 없습니다.");
  return json({ ...s, referralUrl: new URL(`/ref/${s.partner.referralCode}`, cfg.appUrl).toString() });
});
