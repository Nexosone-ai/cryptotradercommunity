import { readContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { adminPartnerServices } from "@/lib/video/service";

export const GET = handler(async () => {
  const { db } = await readContext({ role: "ADMIN" });
  return json(await adminPartnerServices(db));
});
