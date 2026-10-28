import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { badRequest, handler, json, readJson } from "@/lib/http";
import { usdToE8 } from "@/lib/video/models";
import { reviewTopup } from "@/lib/video/service";
import { bi } from "@/lib/i18n";

const body = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  receivedUsd: z.string().max(20).optional(),
  note: z.string().max(500).optional(),
});

/** Approve (credit the amount actually received) or reject a bank top-up. */
export const POST = handler(async (req: Request, ctx: RouteContext<"/api/admin/partner-services/topups/[id]">) => {
  const { id } = await ctx.params;
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 60 });
  const b = body.parse(await readJson(req));
  let received: bigint | undefined;
  if (b.receivedUsd) {
    try {
      received = usdToE8(b.receivedUsd);
    } catch (e) {
      throw badRequest("INVALID_AMOUNT", e instanceof Error ? e.message : bi("The amount is invalid.", "금액이 올바르지 않습니다."));
    }
  }
  return json({ topup: await reviewTopup(db, user, id, b.decision, received, b.note) });
});
