import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getConfig } from "./config";
import { bi, DEFAULT_LOCALE, isBilingual, localize } from "./i18n";

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
export const unauthorized = (msg = bi("Sign in with your wallet first.", "지갑 서명 로그인이 필요합니다.")) => new ApiError(401, "UNAUTHENTICATED", msg);
export const forbidden = (msg = bi("You don't have permission for this.", "권한이 없습니다.")) => new ApiError(403, "FORBIDDEN", msg);
export const notFound = (msg = bi("Not found.", "찾을 수 없습니다.")) => new ApiError(404, "NOT_FOUND", msg);
export const conflict = (code: string, msg: string) => new ApiError(409, code, msg);

export function json(data: unknown, init?: ResponseInit) {
  // bigint → string; bilingual bi() strings → the site language (English).
  const replacer = (_k: string, v: unknown) =>
    typeof v === "bigint" ? v.toString() : typeof v === "string" && isBilingual(v) ? localize(v, DEFAULT_LOCALE) : v;
  return new NextResponse(JSON.stringify(data, replacer), {
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
      { error: { code: "VALIDATION_FAILED", message: bi("Please check your input.", "입력값을 확인해 주세요."), details: err.issues } },
      { status: 400 },
    );
  }
  console.error("[api] unhandled error", err instanceof Error ? err.message : err);
  return json({ error: { code: "INTERNAL", message: bi("Something went wrong on the server.", "서버 오류가 발생했습니다.") } }, { status: 500 });
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
    throw forbidden(bi("Request origin could not be verified.", "요청 출처를 확인할 수 없습니다."));
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw badRequest("INVALID_JSON", bi("The request body is not valid JSON.", "JSON 본문이 올바르지 않습니다."));
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
