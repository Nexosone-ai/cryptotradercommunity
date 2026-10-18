import { z } from "zod";
import { mutationContext, readContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { createPolicyVersion, listPolicies } from "@/lib/ledger/service";

const ppm = z.number().int().min(0).max(1_000_000);
const body = z.object({
  botOwnerSharePpm: ppm,
  platformShareOfPoolPpm: ppm,
  tier1ShareOfPartnerPoolPpm: ppm,
  effectiveFrom: z.iso.datetime(),
  note: z.string().min(1).max(1000),
});

export const GET = handler(async () => {
  const { db } = await readContext({ role: "ADMIN" });
  return json({ policies: await listPolicies(db) });
});

export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 20 });
  const b = body.parse(await readJson(req));
  return json({ policy: await createPolicyVersion(db, user, { ...b, effectiveFrom: new Date(b.effectiveFrom) }) }, { status: 201 });
});
