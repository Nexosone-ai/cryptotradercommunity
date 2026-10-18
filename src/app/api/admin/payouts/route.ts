import { z } from "zod";
import { mutationContext, readContext } from "@/lib/api";
import { payablesByRecipient, payoutsList } from "@/lib/admin/queries";
import { handler, json, readJson } from "@/lib/http";
import { createPayout } from "@/lib/ledger/service";

const body = z.object({ recipientUserId: z.string(), account: z.enum(["BOT_OWNER_PAYABLE", "PARTNER_PAYABLE"]) });

export const GET = handler(async () => {
  const { db } = await readContext({ role: "ADMIN" });
  return json({ payouts: await payoutsList(db), payables: await payablesByRecipient(db) });
});

export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 30 });
  return json({ payout: await createPayout(db, user, body.parse(await readJson(req))) }, { status: 201 });
});
