import { z } from "zod";
import { mutationContext, readContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { listUserOrders, placeOrder } from "@/lib/trading/service";

const body = z.object({
  coin: z.string().regex(/^[A-Z0-9]{1,15}$/),
  isBuy: z.boolean(),
  size: z.string().regex(/^\d+(\.\d+)?$/),
  orderType: z.enum(["MARKET", "LIMIT"]),
  price: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  tif: z.enum(["Gtc", "Ioc", "Alo"]).optional(),
  reduceOnly: z.boolean().optional(),
  confirmMainnet: z.boolean().optional(),
});

export const GET = handler(async () => {
  const { db, user } = await readContext();
  return json({ orders: await listUserOrders(db, user.id) });
});

/**
 * Manual orders only. Bot orders are placed by the bot runner through the
 * same gate (placeOrder with source BOT), never via this public endpoint.
 */
export const POST = handler(async (req: Request) => {
  const { db, hl, user } = await mutationContext(req, { bucket: "order-min", limit: 30 });
  await rateLimit(db, `order-sec:${user.id}`, 3, 1_000);
  const order = await placeOrder(db, hl, user, body.parse(await readJson(req)), { source: "MANUAL" });
  const failed = order.status === "ERROR" || order.status === "REJECTED";
  return json({ order }, { status: failed ? 502 : 201 });
});
