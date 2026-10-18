import { cookies } from "next/headers";
import { z } from "zod";
import { apiContext } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/current";
import { assertSameOrigin, clientIp, handler, json, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { findPartnerByCode, REFERRAL_COOKIE } from "@/lib/referral/service";

const body = z.object({ code: z.string().max(20) });

/**
 * Stores a referral code in an httpOnly cookie until the visitor's first
 * wallet sign-in. Existing accounts are never re-assigned.
 */
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const { db, cfg } = await apiContext();
  await rateLimit(db, `ref:${clientIp(req)}`, 30, 60_000);
  const { code } = body.parse(await readJson(req));
  if (await getCurrentUser()) return json({ stored: false, reason: "ALREADY_REGISTERED" });
  const partner = await findPartnerByCode(db, code);
  if (!partner || partner.eligibilityStatus !== "ACTIVE") return json({ stored: false, reason: "INVALID_CODE" });
  (await cookies()).set(REFERRAL_COOKIE, partner.referralCode, {
    httpOnly: true,
    secure: cfg.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return json({ stored: true });
});
