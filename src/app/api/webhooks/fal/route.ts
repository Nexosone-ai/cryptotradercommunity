import { timingSafeEqual } from "node:crypto";
import { apiContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { getFalGateway } from "@/lib/video/fal";
import { syncOutputByRequestId } from "@/lib/video/service";

function tokenOk(given: string | null) {
  const expected = process.env.FAL_WEBHOOK_TOKEN;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * fal.ai queue webhook. Used only as a trigger: the body is not trusted; the
 * result is re-read from fal with the server's own key.
 */
export const POST = handler(async (req: Request) => {
  if (!tokenOk(new URL(req.url).searchParams.get("token"))) return json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { request_id?: unknown } | null;
  const requestId = typeof body?.request_id === "string" ? body.request_id : null;
  if (!requestId) return json({ ok: false }, { status: 400 });
  const { db } = await apiContext();
  const out = await syncOutputByRequestId(db, getFalGateway(), requestId);
  return json({ ok: true, known: Boolean(out) });
});
