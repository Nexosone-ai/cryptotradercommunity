import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { setAffiliateStatus } from "@/lib/referral/service";

const body = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) });

/** Wholesale partner suspends or reactivates one of their own affiliates. */
export const POST = handler(async (req: Request, ctx: RouteContext<"/api/partner/affiliates/[id]">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { role: "PARTNER", bucket: "partner-affiliates", limit: 30 });
  return json({ partner: await setAffiliateStatus(db, user, id, body.parse(await readJson(req)).status) });
});
