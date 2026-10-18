import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { confirmAndAllocate } from "@/lib/ledger/service";

const body = z.object({ eventIds: z.array(z.string()).min(1).max(500), reason: z.string().min(1).max(2000) });

/** Marks observed builder-fee events as confirmed revenue and allocates them. */
export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { role: "ADMIN", bucket: "admin", limit: 60 });
  const { eventIds, reason } = body.parse(await readJson(req));
  return json({ results: await confirmAndAllocate(db, user, eventIds, reason) });
});
