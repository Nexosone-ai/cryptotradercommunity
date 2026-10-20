import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { setTokenListed } from "@/lib/swap/service";

const body = z.object({ listed: z.boolean() });

/** Marks a token as reviewed (listed) or back to custom. */
export const POST = handler(async (req: Request, ctx: RouteContext<"/api/admin/swap/tokens/[id]/list">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 60 });
  return json({ token: await setTokenListed(db, user, id, body.parse(await readJson(req)).listed) });
});
