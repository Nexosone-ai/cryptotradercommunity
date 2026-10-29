import { z } from "zod";
import { mutationContext, readContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { grantPartner, listPartners } from "@/lib/referral/admin";

const body = z.object({ walletAddress: z.string().trim() });

/** Referral partners are appointed by an admin only (no public sign-up). */
export const GET = handler(async () => {
  const { db } = await readContext({ role: "ADMIN" });
  return json({ partners: await listPartners(db) });
});

export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 30 });
  const partner = await grantPartner(db, user, body.parse(await readJson(req)).walletAddress);
  return json({ partner }, { status: 201 });
});
