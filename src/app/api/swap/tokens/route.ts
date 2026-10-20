import { z } from "zod";
import { apiContext, mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { getSwapReader } from "@/lib/swap/reader";
import { addToken, listTokens } from "@/lib/swap/service";

export const GET = handler(async (req: Request) => {
  const { db } = await apiContext();
  const chainId = z.coerce.number().int().positive().parse(new URL(req.url).searchParams.get("chainId"));
  return json({ tokens: await listTokens(db, chainId) });
});

const body = z.object({ chainId: z.number().int().positive(), address: z.string().max(64) });

/** Adds a custom token by contract address (metadata read from the chain). */
export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { bucket: "swap-token", limit: 20 });
  const b = body.parse(await readJson(req));
  return json({ token: await addToken(db, getSwapReader(), user, b.chainId, b.address) }, { status: 201 });
});
