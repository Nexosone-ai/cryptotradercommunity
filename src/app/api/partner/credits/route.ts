import { z } from "zod";
import { mutationContext, readContext } from "@/lib/api";
import { getFxProvider } from "@/lib/fx";
import { handler, json, readJson } from "@/lib/http";
import { packageQuotes, requestTopup } from "@/lib/video/service";

/** Credit packages with current KRW prices (USD × rate + 10% VAT). */
export const GET = handler(async () => {
  await readContext({ role: "PARTNER" });
  return json(await packageQuotes(getFxProvider()));
});

const body = z.object({ packageUsd: z.number().int().positive() });

/** Requests a package; the KRW quote is locked and credited after the deposit is confirmed. */
export const POST = handler(async (req: Request) => {
  const { db, user } = await mutationContext(req, { role: "PARTNER", bucket: "partner-topup", limit: 10 });
  return json(await requestTopup(db, getFxProvider(), user, body.parse(await readJson(req)).packageUsd), { status: 201 });
});
