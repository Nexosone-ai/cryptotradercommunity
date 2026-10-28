import { z } from "zod";
import { bi, localize } from "../i18n";

/**
 * Strategy source code attached to a bot (e.g. a TradingView Pine Script).
 *
 * The platform never executes this code (docs/MASTER_PROMPT.md §3.3): it is
 * stored, versioned and shown to reviewers — and to the public only if the
 * owner chooses PUBLIC. Pure functions only: used by the wizard and the server.
 */

export const SOURCE_LANGUAGES = ["PINESCRIPT", "PYTHON", "JAVASCRIPT", "TYPESCRIPT", "OTHER"] as const;
export const SOURCE_LANGUAGE_LABELS: Record<(typeof SOURCE_LANGUAGES)[number], string> = {
  PINESCRIPT: "Pine Script (TradingView)",
  PYTHON: "Python",
  JAVASCRIPT: "JavaScript",
  TYPESCRIPT: "TypeScript",
  OTHER: bi("Other", "기타"),
};
export const SOURCE_VISIBILITIES = ["PRIVATE", "PUBLIC"] as const;
export const MAX_SOURCE_BYTES = 200_000;

export type SourceLanguage = (typeof SOURCE_LANGUAGES)[number];
export type SourceVisibility = (typeof SOURCE_VISIBILITIES)[number];

export interface PineMeta {
  version: number | null;
  kind: "indicator" | "strategy" | "library" | null;
  title: string | null;
  inputs: number;
  alerts: number;
  orders: number;
}

/** Stored in the bot config; the code itself lives in `bot_sources`. */
export interface SourceMeta {
  language: SourceLanguage;
  visibility: SourceVisibility;
  sha256: string;
  bytes: number;
  lines: number;
  pine: PineMeta | null;
}

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: bi("Private key (64 hex characters)", "개인키(64자리 16진수)"), re: /(?<![0-9a-fA-F])(0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/ },
  { name: bi("Mnemonic / seed phrase", "니모닉/시드 구문"), re: /\b(mnemonic|seed[ _-]?phrase)\b\s*[:=]/i },
  { name: bi("OpenAI/Anthropic-style API key", "OpenAI/Anthropic 계열 키"), re: /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/ },
  { name: bi("AWS access key", "AWS 액세스 키"), re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: bi("PEM private key", "PEM 개인키"), re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: bi("API secret assignment", "API 시크릿 할당"), re: /\b(api[_-]?secret|secret[_-]?key|private[_-]?key)\b\s*[:=]\s*["'][^"']{12,}["']/i },
];

/** Names of secret-looking patterns found in the code (empty = clean). */
export function detectSecrets(code: string): string[] {
  return SECRET_PATTERNS.filter((p) => p.re.test(code)).map((p) => p.name);
}

/** Lightweight Pine Script header scan (no execution, no full parse). */
export function pineMeta(code: string): PineMeta {
  const version = /^\s*\/\/\s*@version\s*=\s*(\d+)/m.exec(code);
  const decl = /^\s*(indicator|strategy|library)\s*\(\s*(?:title\s*=\s*)?(["'])(.*?)\2/m.exec(code);
  const count = (re: RegExp) => (code.match(re) ?? []).length;
  return {
    version: version ? Number(version[1]) : null,
    kind: decl ? (decl[1] as PineMeta["kind"]) : null,
    title: decl ? decl[3].slice(0, 120) : null,
    inputs: count(/\binput(?:\.\w+)?\s*\(/g),
    alerts: count(/\b(?:alertcondition|alert)\s*\(/g),
    orders: count(/\bstrategy\.(?:entry|order|exit|close)\s*\(/g),
  };
}

export const sourceInputSchema = z
  .object({
    language: z.enum(SOURCE_LANGUAGES),
    visibility: z.enum(SOURCE_VISIBILITIES).default("PRIVATE"),
    code: z
      .string()
      .min(20, bi("The source code is too short.", "소스코드가 너무 짧습니다."))
      .refine((c) => new TextEncoder().encode(c).length <= MAX_SOURCE_BYTES, bi("Source code must be 200KB or less.", "소스코드는 200KB 이하여야 합니다."))
      .refine((c) => !c.includes("\u0000"), bi("Binary files can't be attached.", "바이너리 파일은 첨부할 수 없습니다.")),
  })
  .superRefine((s, ctx) => {
    const secrets = detectSecrets(s.code);
    if (secrets.length) {
      ctx.addIssue({
        code: "custom",
        path: ["code"],
        message: bi(
          `The source code appears to contain secrets (${secrets.map((n) => localize(n, "en")).join(", ")}). Remove keys and seed phrases before attaching it.`,
          `소스코드에 비밀값으로 보이는 내용이 있습니다(${secrets.map((n) => localize(n, "ko")).join(", ")}). 키·시드는 제거한 뒤 첨부하세요.`,
        ),
      });
    }
    if (s.language === "PINESCRIPT" && !/\b(indicator|strategy|library)\s*\(/.test(s.code)) {
      ctx.addIssue({ code: "custom", path: ["code"], message: bi("Pine Script must declare indicator(), strategy() or library().", "Pine Script에는 indicator(), strategy() 또는 library() 선언이 있어야 합니다.") });
    }
  });

export type SourceInput = z.infer<typeof sourceInputSchema>;

/** Normalizes line endings so the same script always hashes the same. */
export function normalizeSource(code: string): string {
  return code.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trimEnd() + "\n";
}
