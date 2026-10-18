import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { badRequest, handler, json, readJson } from "@/lib/http";
import { activatePartner } from "@/lib/referral/service";

const body = z.object({ acceptPartnerTerms: z.boolean() });

export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { bucket: "partner", limit: 5 });
  if (!body.parse(await readJson(req)).acceptPartnerTerms) {
    throw badRequest("TERMS_REQUIRED", "파트너 약관에 동의해야 합니다.");
  }
  const partner = await activatePartner(db, user.id, user.walletAddress);
  return json({ referralCode: partner.referralCode, eligibilityStatus: partner.eligibilityStatus });
});
