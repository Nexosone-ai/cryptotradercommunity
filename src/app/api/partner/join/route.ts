import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { joinAsAffiliate } from "@/lib/referral/service";

const body = z.object({ code: z.string().trim().min(6).max(12) });

/** A signed-in user accepts a wholesale partner's invite and becomes their affiliate. */
export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { bucket: "partner-join", limit: 10 });
  const partner = await joinAsAffiliate(db, user, body.parse(await readJson(req)).code);
  return json({ partner }, { status: 201 });
});
