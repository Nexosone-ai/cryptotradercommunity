import { mutationContext } from "@/lib/api";
import { reviewBot } from "@/lib/bots/service";
import { handler, json } from "@/lib/http";

export const POST = handler(async (req: Request, ctx: RouteContext<"/api/admin/bots/[id]/approve">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 60 });
  return json({ bot: await reviewBot(db, user, id, "APPROVE") });
});
