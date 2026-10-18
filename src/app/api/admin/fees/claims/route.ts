import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { recordBuilderClaim } from "@/lib/ledger/service";
import { parseUsdcE8 } from "@/lib/money";

const body = z.object({ amountUsdc: z.string().regex(/^\d+(\.\d{1,8})?$/), reference: z.string().min(1).max(200) });

/** Records a builder-reward claim executed by the operator on Hyperliquid. */
export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 20 });
  const b = body.parse(await readJson(req));
  return json({ journalId: await recordBuilderClaim(db, user, parseUsdcE8(b.amountUsdc).amount, b.reference) });
});
