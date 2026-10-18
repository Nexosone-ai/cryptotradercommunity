import { mutationContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { prepareAgent, revokeAgent } from "@/lib/trading/service";

/** Creates a new agent wallet; the browser then asks MetaMask to sign approveAgent. */
export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { bucket: "agent", limit: 10 });
  return json(await prepareAgent(db, user));
});

/** Stops platform use of the agent immediately. Removing it on Hyperliquid is done by the user. */
export const DELETE = handler(async (req: Request) => {
  const { db, user, cfg } = await mutationContext(req, { bucket: "agent", limit: 10 });
  await revokeAgent(db, user, cfg.network);
  return json({ ok: true });
});
