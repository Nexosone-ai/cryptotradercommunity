import { readContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { falConfigured, getFalGateway } from "@/lib/video/fal";
import { getJob, refreshJob } from "@/lib/video/service";

/** Job + clips. Unfinished clips are refreshed from fal (covers missed webhooks and local dev). */
export const GET = handler(async (_req: Request, ctx: RouteContext<"/api/partner/video/jobs/[id]">) => {
  const { id } = await ctx.params;
  const { db, user } = await readContext({ role: "PARTNER" });
  await getJob(db, user, id); // ownership check first
  if (falConfigured()) await refreshJob(db, getFalGateway(), id);
  return json(await getJob(db, user, id));
});
