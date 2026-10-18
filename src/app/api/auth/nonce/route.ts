import { z } from "zod";
import { apiContext } from "@/lib/api";
import { issueSiweMessage } from "@/lib/auth/siwe";
import { assertSameOrigin, clientIp, handler, json, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

const body = z.object({ address: z.string(), chainId: z.number().int().positive() });

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const { db, cfg } = await apiContext();
  await rateLimit(db, `nonce:${clientIp(req)}`, 20, 60_000);
  const { address, chainId } = body.parse(await readJson(req));
  const { message, expiresAt } = await issueSiweMessage(db, {
    address,
    chainId,
    domain: cfg.appUrl.host,
    uri: cfg.appUrl.origin,
  });
  return json({ message, expiresAt });
});
