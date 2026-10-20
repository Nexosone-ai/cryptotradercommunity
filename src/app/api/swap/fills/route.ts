import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { getSwapReader } from "@/lib/swap/reader";
import { recordFills } from "@/lib/swap/service";

const body = z.object({ chainId: z.number().int().positive(), txHash: z.string() });

/** Records OrderFilled events from a confirmed transaction (read from the chain, not trusted from the client). */
export const POST = handler(async (req: Request) => {
  const { db } = await mutationContext(req, { bucket: "swap-fill", limit: 30 });
  const b = body.parse(await readJson(req));
  return json(await recordFills(db, getSwapReader(), b.chainId, b.txHash));
});
