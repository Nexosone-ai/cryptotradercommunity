import { cookies } from "next/headers";
import { z } from "zod";
import { apiContext } from "@/lib/api";
import { signIn } from "@/lib/auth/service";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { assertSameOrigin, clientIp, handler, json, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { REFERRAL_COOKIE } from "@/lib/referral/service";

const body = z.object({
  message: z.string().min(1).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  acceptTerms: z.boolean().default(false),
});

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const { db, cfg } = await apiContext();
  await rateLimit(db, `verify:${clientIp(req)}`, 20, 60_000);
  const input = body.parse(await readJson(req));
  const jar = await cookies();
  const r = await signIn(db, {
    message: input.message,
    signature: input.signature as `0x${string}`,
    expectedDomain: cfg.appUrl.host,
    acceptTerms: input.acceptTerms,
    referralCode: jar.get(REFERRAL_COOKIE)?.value ?? null,
  });
  jar.set(SESSION_COOKIE, r.session.token, {
    httpOnly: true,
    secure: cfg.isProduction,
    sameSite: "lax",
    path: "/",
    expires: r.session.expiresAt,
  });
  jar.delete(REFERRAL_COOKIE);
  return json({
    user: { id: r.user.id, walletAddress: r.user.walletAddress },
    isNew: r.isNew,
    referral: r.referral?.status ?? null,
  });
});
