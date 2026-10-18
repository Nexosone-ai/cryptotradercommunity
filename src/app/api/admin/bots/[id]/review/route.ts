import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { reviewBot } from "@/lib/bots/service";
import { handler, json, readJson } from "@/lib/http";

const body = z.object({
  decision: z.enum(["START_REVIEW", "APPROVE", "REJECT", "SUSPEND"]),
  reason: z.string().max(2000).optional(),
});

export const POST = handler(async (req: Request, ctx: RouteContext<"/api/admin/bots/[id]/review">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 60 });
  const { decision, reason } = body.parse(await readJson(req));
  return json({ bot: await reviewBot(db, user, id, decision, reason) });
});
