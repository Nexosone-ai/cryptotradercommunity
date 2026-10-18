import { mutationContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { verifyAgent } from "@/lib/trading/service";

export const POST = handler(async (req: Request) => {
  const { db, hl, user } = await mutationContext(req, { bucket: "agent", limit: 20 });
  return json(await verifyAgent(db, hl, user));
});
