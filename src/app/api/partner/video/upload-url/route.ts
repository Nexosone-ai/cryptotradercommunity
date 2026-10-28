import { z } from "zod";
import { mutationContext } from "@/lib/api";
import { ApiError, handler, json, readJson } from "@/lib/http";
import { falConfigured, getFalGateway } from "@/lib/video/fal";
import { bi } from "@/lib/i18n";

const MAX_BYTES = 80 * 1024 * 1024;
const body = z.object({
  contentType: z.enum(["video/mp4", "video/quicktime", "video/webm"]),
  fileName: z.string().min(1).max(120),
  size: z.number().int().positive().max(MAX_BYTES),
});

/**
 * One-time fal.ai storage upload URL. The browser PUTs the video directly to
 * fal (so large files skip the serverless body limit); FAL_KEY never leaves the server.
 */
export const POST = handler(async (req: Request) => {
  await mutationContext(req, { role: "PARTNER", bucket: "video-upload", limit: 20 });
  if (!falConfigured()) throw new ApiError(503, "FAL_NOT_CONFIGURED", bi("The video generation service isn't configured yet.", "영상 생성 서비스가 아직 설정되지 않았습니다."));
  const b = body.parse(await readJson(req));
  const safeName = b.fileName.replace(/[^\w.-]/g, "_");
  return json(await getFalGateway().initiateUpload(b.contentType, safeName));
});
