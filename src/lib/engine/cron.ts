import { getConfig } from "../config";
import { ApiError } from "../http";

/** Vercel Cron sends "Authorization: Bearer $CRON_SECRET". Without a configured secret the jobs refuse to run. */
export function assertCron(req: Request) {
  const secret = getConfig().cronSecret;
  if (!secret) throw new ApiError(503, "CRON_NOT_CONFIGURED", "CRON_SECRET isn't set.");
  if (req.headers.get("authorization") !== `Bearer ${secret}`) throw new ApiError(401, "UNAUTHORIZED", "Invalid cron secret.");
}
