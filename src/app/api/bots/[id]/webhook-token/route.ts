import { mutationContext } from "@/lib/api";
import { rotateWebhookToken } from "@/lib/engine/manage";
import { handler, json } from "@/lib/http";

/** Owner-only: creates or replaces the signal-webhook token. The token is shown once. */
export const POST = handler(async (req: Request, ctx: RouteContext<"/api/bots/[id]/webhook-token">) => {
  const { id } = await ctx.params;
  const { db, user, cfg } = await mutationContext(req, { bucket: "webhook-token", limit: 10 });
  const token = await rotateWebhookToken(db, user, id);
  return json({ token, url: new URL(`/api/bots/${id}/signal`, cfg.appUrl).toString() });
});
