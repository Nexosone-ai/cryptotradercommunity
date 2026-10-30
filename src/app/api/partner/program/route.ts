import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { getPolicyAt } from "@/lib/ledger/service";
import { partnerPoolPpm, setWholesalerPortion } from "@/lib/referral/service";

/** Portion in points of the fee (10 = 10%), up to 4 decimals. */
const body = z.object({ portionPct: z.number().min(0).max(100) });

/** Wholesale partner sets what they keep of each fee their affiliates' clients pay. */
export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { role: "PARTNER", bucket: "partner-program", limit: 20 });
  const { portionPct } = body.parse(await readJson(req));
  const max = partnerPoolPpm(await getPolicyAt(db, new Date()));
  const partner = await setWholesalerPortion(db, user, Math.round(portionPct * 10_000), max);
  return json({ partner });
});
