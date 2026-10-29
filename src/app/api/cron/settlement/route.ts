import { apiContext } from "@/lib/api";
import { assertCron } from "@/lib/engine/cron";
import { handler, json } from "@/lib/http";
import { syncAllAccounts } from "@/lib/settlement/ingest";

export const maxDuration = 60;

/** Every 5 minutes (vercel.json): pull fills so bot performance and Builder Fee events stay current. */
export const GET = handler(async (req: Request) => {
  assertCron(req);
  const { db, hl } = await apiContext();
  return json(await syncAllAccounts(db, hl));
});
