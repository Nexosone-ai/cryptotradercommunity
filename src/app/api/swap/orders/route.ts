import { z } from "zod";
import { apiContext, mutationContext } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/current";
import { handler, json, readJson, unauthorized } from "@/lib/http";
import { getSwapReader } from "@/lib/swap/reader";
import { createOrder, listOrders, orderView } from "@/lib/swap/service";

const STATUSES = ["OPEN", "FILLED", "CANCELLED", "EXPIRED"] as const;

export const GET = handler(async (req: Request) => {
  const { db } = await apiContext();
  const p = new URL(req.url).searchParams;
  const chainId = z.coerce.number().int().positive().parse(p.get("chainId"));
  const status = p.get("status");
  let makerUserId: string | undefined;
  if (p.get("mine") === "1") {
    const user = await getCurrentUser();
    if (!user) throw unauthorized();
    makerUserId = user.id;
  }
  const rows = await listOrders(db, {
    chainId,
    tokenA: p.get("tokenA") ?? undefined,
    tokenB: p.get("tokenB") ?? undefined,
    makerUserId,
    status: status && (STATUSES as readonly string[]).includes(status) ? [status] : makerUserId ? undefined : ["OPEN"],
  });
  return json({ orders: rows.map(orderView) });
});

const uint = z.string().regex(/^\d{1,78}$/);
const body = z.object({
  chainId: z.number().int().positive(),
  order: z.object({
    maker: z.string(),
    sellToken: z.string(),
    buyToken: z.string(),
    sellAmount: uint,
    buyAmount: uint,
    taker: z.string(),
    expiry: uint,
    nonce: uint,
  }),
  signature: z.string().max(2000),
});

/** Posts a maker-signed order to the shared order book. */
export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { bucket: "swap-order", limit: 30 });
  const row = await createOrder(db, getSwapReader(), user, body.parse(await readJson(req)));
  return json({ order: orderView(row) }, { status: 201 });
});
