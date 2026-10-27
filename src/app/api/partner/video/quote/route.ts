import { z } from "zod";
import { readContext } from "@/lib/api";
import { handler, json } from "@/lib/http";
import { quoteVideoJob } from "@/lib/video/models";
import { videoSettings } from "@/lib/video/service";

const query = z.object({ resolution: z.enum(["480P", "768P"]), seconds: z.coerce.number().int() });

export const GET = handler(async (req: Request) => {
  await readContext({ role: "PARTNER" });
  const p = new URL(req.url).searchParams;
  const q = query.parse({ resolution: p.get("resolution"), seconds: p.get("seconds") });
  return json({ quote: quoteVideoJob(q.resolution, q.seconds, videoSettings().markupPpm) });
});
