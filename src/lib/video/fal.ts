import "server-only";
import { createFalClient } from "@fal-ai/client";
import { FRAME_MODEL, VIDEO_MODEL, VISION_LLM, VISION_MODEL_ENDPOINT, type Resolution } from "./models";

/**
 * All fal.ai access for the partner video service (injectable for tests).
 * FAL_KEY stays on the server; the browser only receives a one-time upload URL.
 */
export interface FalGateway {
  initiateUpload(contentType: string, fileName: string): Promise<{ uploadUrl: string; fileUrl: string }>;
  extractFrame(videoUrl: string): Promise<string>;
  /** Describes the frame and returns `count` prompts for similar videos. */
  planVariations(imageUrl: string, brief: string, count: number): Promise<{ description: string; prompts: string[] }>;
  submitVideo(input: { prompt: string; imageUrl: string; seconds: number; resolution: Resolution }, webhookUrl?: string): Promise<string>;
  /** IN_QUEUE / IN_PROGRESS, or COMPLETED with a video URL or an error. */
  videoResult(requestId: string): Promise<{ status: "IN_QUEUE" | "IN_PROGRESS" } | { status: "COMPLETED"; videoUrl: string } | { status: "FAILED"; error: string }>;
}

export function falConfigured() {
  return Boolean(process.env.FAL_KEY);
}

const PLAN_SYSTEM = `You write prompts for an image-to-video model.
Given a still frame from a user's video and an optional brief, write a one-paragraph description of the scene,
then N distinct prompts for short videos that keep the same subject, setting and mood but vary camera motion,
action, framing, lighting or pacing. Each prompt: one or two sentences, concrete, visual, no text overlays,
no brand names, no financial claims or promises of profit. Answer with JSON only:
{"description": "...", "prompts": ["...", "..."]}`;

function parsePlan(text: string, count: number) {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as { description?: unknown; prompts?: unknown };
  const prompts = Array.isArray(parsed.prompts) ? parsed.prompts.filter((p): p is string => typeof p === "string" && p.trim().length > 0) : [];
  if (prompts.length < count) throw new Error(`Vision model returned ${prompts.length} prompts, expected ${count}`);
  return { description: String(parsed.description ?? "").slice(0, 2000), prompts: prompts.slice(0, count).map((p) => p.slice(0, 1500)) };
}

export function createFalGateway(): FalGateway {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not configured");
  const fal = createFalClient({ credentials: key });

  return {
    async initiateUpload(contentType, fileName) {
      const res = await fetch("https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: contentType, file_name: fileName }),
      });
      if (!res.ok) throw new Error(`fal upload initiate failed (${res.status})`);
      const data = (await res.json()) as { upload_url: string; file_url: string };
      return { uploadUrl: data.upload_url, fileUrl: data.file_url };
    },
    async extractFrame(videoUrl) {
      const r = await fal.subscribe(FRAME_MODEL, { input: { video_url: videoUrl, frame_type: "middle" } });
      const url = (r.data as { images?: { url: string }[] }).images?.[0]?.url;
      if (!url) throw new Error("Frame extraction returned no image");
      return url;
    },
    async planVariations(imageUrl, brief, count) {
      const r = await fal.subscribe(VISION_MODEL_ENDPOINT, {
        input: {
          model: VISION_LLM,
          image_urls: [imageUrl],
          system_prompt: PLAN_SYSTEM.replace("N distinct", `${count} distinct`),
          prompt: `Brief from the creator (may be empty): ${brief || "(none)"}\nReturn exactly ${count} prompts.`,
          temperature: 0.9,
          max_tokens: 3000,
        },
      });
      return parsePlan((r.data as { output: string }).output, count);
    },
    async submitVideo(input, webhookUrl) {
      const r = await fal.queue.submit(VIDEO_MODEL, {
        input: {
          prompt: input.prompt,
          image_url: input.imageUrl,
          duration: input.seconds,
          resolution: input.resolution,
          prompt_expansion_mode: "balanced",
          enable_safety_checker: true,
        },
        webhookUrl,
      });
      return r.request_id;
    },
    async videoResult(requestId) {
      const s = await fal.queue.status(VIDEO_MODEL, { requestId });
      if (s.status !== "COMPLETED") return { status: s.status };
      try {
        const r = await fal.queue.result(VIDEO_MODEL, { requestId });
        const url = (r.data as { video?: { url?: string } }).video?.url;
        return url ? { status: "COMPLETED", videoUrl: url } : { status: "FAILED", error: "No video in result" };
      } catch (e) {
        return { status: "FAILED", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
      }
    },
  };
}

let shared: FalGateway | undefined;
export function getFalGateway(): FalGateway {
  return (shared ??= createFalGateway());
}

export { parsePlan as parsePlanForTests };
