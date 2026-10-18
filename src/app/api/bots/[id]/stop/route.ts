import { mutationContext } from "@/lib/api";
import { ownerSetStatus } from "@/lib/bots/service";
import { handler, json } from "@/lib/http";

export const POST = handler(async (req: Request, ctx: RouteContext<"/api/bots/[id]/stop">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { bucket: "bot-status", limit: 20 });
  return json({ bot: await ownerSetStatus(db, user, id, "PAUSED") });
});
