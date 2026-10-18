import { readContext } from "@/lib/api";
import { auditLogs } from "@/lib/admin/queries";
import { handler, json } from "@/lib/http";

export const GET = handler(async () => {
  const { db } = await readContext({ role: "ADMIN" });
  return json(await auditLogs(db));
});
