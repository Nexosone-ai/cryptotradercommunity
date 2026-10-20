import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { getSwapReader } from "@/lib/swap/reader";
import { recordDeployment } from "@/lib/swap/service";

const body = z.object({ chainId: z.number().int().positive(), txHash: z.string() });

/** Records a settlement contract the admin deployed from their own wallet, after verifying its code on-chain. */
export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 20 });
  const b = body.parse(await readJson(req));
  return json({ deployment: await recordDeployment(db, getSwapReader(), user, b.chainId, b.txHash) }, { status: 201 });
});
