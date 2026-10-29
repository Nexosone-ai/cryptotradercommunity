import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { setPartnerStatus } from "@/lib/referral/admin";

const body = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) });

export const POST = handler(async (req: Request, ctx: RouteContext<"/api/admin/partners/[id]">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 60 });
  return json({ partner: await setPartnerStatus(db, user, id, body.parse(await readJson(req)).status) });
});
