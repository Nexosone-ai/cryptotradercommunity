import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { reviewBot } from "@/lib/bots/service";
import { handler, json, readJson } from "@/lib/http";

const body = z.object({ reason: z.string().min(1).max(2000) });

export const POST = handler(async (req: Request, ctx: RouteContext<"/api/admin/bots/[id]/reject">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 60 });
  const { reason } = body.parse(await readJson(req));
  return json({ bot: await reviewBot(db, user, id, "REJECT", reason) });
});
