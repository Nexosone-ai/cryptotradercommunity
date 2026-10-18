import { cookies } from "next/headers";
import { apiContext } from "@/lib/api";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth/session";
import { assertSameOrigin, handler, json } from "@/lib/http";

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession((await apiContext()).db, token);
  jar.delete(SESSION_COOKIE);
  return json({ ok: true });
});
