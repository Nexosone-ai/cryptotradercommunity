import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getConfig } from "./config";

/** Error with an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string, details?: unknown) => new ApiError(400, code, msg, details);
export const unauthorized = (msg = "지갑 서명 로그인이 필요합니다.") => new ApiError(401, "UNAUTHENTICATED", msg);
export const forbidden = (msg = "권한이 없습니다.") => new ApiError(403, "FORBIDDEN", msg);
export const notFound = (msg = "찾을 수 없습니다.") => new ApiError(404, "NOT_FOUND", msg);
export const conflict = (code: string, msg: string) => new ApiError(409, code, msg);

function jsonSafe(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

export function json(data: unknown, init?: ResponseInit) {
  return new NextResponse(JSON.stringify(data, jsonSafe), {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...init?.headers },
  });
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return json(
      { error: { code: "VALIDATION_FAILED", message: "입력값을 확인해 주세요.", details: err.issues } },
      { status: 400 },
    );
  }
  console.error("[api] unhandled error", err instanceof Error ? err.message : err);
  return json({ error: { code: "INTERNAL", message: "서버 오류가 발생했습니다." } }, { status: 500 });
}

/** Wraps a route handler with uniform error handling. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * CSRF defence for state-changing requests: the Origin header must match the
 * app origin (session cookie is also SameSite=Lax).
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const expected = getConfig().appUrl.origin;
  const reqOrigin = new URL(req.url).origin;
  if (!origin || (origin !== expected && origin !== reqOrigin)) {
    throw forbidden("요청 출처를 확인할 수 없습니다.");
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw badRequest("INVALID_JSON", "JSON 본문이 올바르지 않습니다.");
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
