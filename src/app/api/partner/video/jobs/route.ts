import { z } from "zod";
import { mutationContext, readContext } from "@/lib/api";
import { handler, json, readJson } from "@/lib/http";
import { getFalGateway } from "@/lib/video/fal";
import { createVideoJob, listJobs } from "@/lib/video/service";

// Frame extraction + vision planning + 10 queue submissions run in this request.
export const maxDuration = 120;

const body = z.object({
  sourceVideoUrl: z.string().url().max(500),
  resolution: z.enum(["480P", "768P"]),
  clipSeconds: z.number().int(),
  brief: z.string().max(1000).optional(),
  rightsConfirmed: z.boolean(),
});

export const GET = handler(async () => {
  const { db, user } = await readContext({ role: "PARTNER" });
  return json({ jobs: await listJobs(db, user.id) });
});

export const POST = handler(async (req: Request) => {
  const { db, user, cfg } = await mutationContext(req, { role: "PARTNER", bucket: "video-job", limit: 10 });
  return json(await createVideoJob(db, getFalGateway(), user, body.parse(await readJson(req)), cfg.appUrl), { status: 201 });
});
