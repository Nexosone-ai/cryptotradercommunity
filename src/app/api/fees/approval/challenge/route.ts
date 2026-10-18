import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { builderApprovalChallenge } from "@/lib/trading/service";

const body = z.object({ requiredTenthsBp: z.number().int().min(0).max(100) });

/**
 * Returns the exact approveBuilderFee parameters (builder chosen by the
 * server). The signature itself is produced by the user's main wallet.
 */
export const POST = handler(async (req: Request) => {
  await mutationContext(req, { bucket: "approval", limit: 20 });
  const { requiredTenthsBp } = body.parse(await readJson(req));
  return json(builderApprovalChallenge(requiredTenthsBp));
});
