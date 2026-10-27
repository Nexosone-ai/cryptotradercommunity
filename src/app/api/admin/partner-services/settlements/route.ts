import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { badRequest, handler, json, readJson } from "@/lib/http";
import { usdToE8 } from "@/lib/video/models";
import { settlePartner } from "@/lib/video/service";

const body = z.object({ partnerUserId: z.string(), amountUsd: z.string().max(20), bankReference: z.string().max(200) });

/** Records a bank transfer from the company to a partner against invoice earnings. */
export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 30 });
  const b = body.parse(await readJson(req));
  let amount: bigint;
  try {
    amount = usdToE8(b.amountUsd);
  } catch (e) {
    throw badRequest("INVALID_AMOUNT", e instanceof Error ? e.message : "금액이 올바르지 않습니다.");
  }
  return json({ settlement: await settlePartner(db, user, b.partnerUserId, amount, b.bankReference) }, { status: 201 });
});
