"use client";

import { useMemo } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Badge, Notice } from "@/components/ui";
import {
  detectSecrets,
  MAX_SOURCE_BYTES,
  pineMeta,
  SOURCE_LANGUAGE_LABELS,
  SOURCE_LANGUAGES,
  type SourceLanguage,
  type SourceVisibility,
} from "@/lib/bots/source";

export interface SourceValue {
  language: SourceLanguage;
  visibility: SourceVisibility;
  code: string;
}

const ACCEPT = ".pine,.txt,.py,.js,.ts,.mjs";

function guessLanguage(fileName: string, code: string): SourceLanguage {
  if (/\.pine$/i.test(fileName) || /\/\/\s*@version\s*=/.test(code)) return "PINESCRIPT";
  if (/\.py$/i.test(fileName)) return "PYTHON";
  if (/\.ts$/i.test(fileName)) return "TYPESCRIPT";
  if (/\.m?js$/i.test(fileName)) return "JAVASCRIPT";
  return "OTHER";
}

/**
 * Optional strategy source attachment. Stored and shown to reviewers; never
 * executed by the platform. Private by default.
 */
export function SourceEditor({ value, onChange, error }: { value: SourceValue | undefined; onChange: (v: SourceValue | undefined) => void; error: React.ReactNode }) {
  const { t, L } = useI18n();
  const code = value?.code ?? "";
  const bytes = useMemo(() => new TextEncoder().encode(code).length, [code]);
  const secrets = useMemo(() => (code ? detectSecrets(code) : []), [code]);
  const pine = useMemo(() => (value?.language === "PINESCRIPT" && code ? pineMeta(code) : null), [value?.language, code]);

  if (!value) {
    return (
      <div className="rounded-lg border border-dashed border-accent/50 bg-accent/5 p-4 text-sm">
        <p className="font-medium">{t("Attach strategy source code (optional)", "전략 소스코드 첨부 (선택)")}</p>
        <p className="mt-1 text-xs text-muted">
          {t(
            "You can attach strategy code such as TradingView Pine Script for review. The platform never runs attached code.",
            "TradingView Pine Script 등 전략 코드를 심사용으로 첨부할 수 있습니다. 플랫폼은 첨부한 코드를 실행하지 않습니다.",
          )}
        </p>
        <button
          type="button"
          className="mt-3 rounded-lg border border-accent/60 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/10"
          onClick={() => onChange({ language: "PINESCRIPT", visibility: "PRIVATE", code: "" })}
        >
          {t("+ Attach source code", "+ 소스코드 첨부")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-line-strong p-4" data-testid="source-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{t("Strategy source code", "전략 소스코드")}</p>
        <button type="button" className="text-xs text-muted underline" onClick={() => onChange(undefined)}>
          {t("Remove attachment", "첨부 취소")}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="src-lang">{t("Language", "언어")}</label>
          <select id="src-lang" value={value.language} onChange={(e) => onChange({ ...value, language: e.target.value as SourceLanguage })}>
            {SOURCE_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {L(SOURCE_LANGUAGE_LABELS[l])}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="src-file">{t(`Load from file (${ACCEPT})`, `파일에서 불러오기 (${ACCEPT})`)}</label>
          <input
            id="src-file"
            type="file"
            accept={ACCEPT}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              onChange({ ...value, code: text, language: guessLanguage(file.name, text) });
            }}
          />
        </div>
      </div>
      <div>
        <label htmlFor="src-code">{t("Paste code", "코드 붙여넣기")}</label>
        <textarea
          id="src-code"
          rows={16}
          spellCheck={false}
          value={code}
          onChange={(e) => onChange({ ...value, code: e.target.value })}
          className="font-mono text-xs leading-relaxed"
          placeholder={'//@version=6\nindicator("My strategy", overlay=true)\n…'}
        />
        <p className={`mt-1 text-[11px] ${bytes > MAX_SOURCE_BYTES ? "text-down" : "text-faint"}`}>
          {t(`${code.split("\n").length.toLocaleString()} lines`, `${code.split("\n").length.toLocaleString()}줄`)} · {(bytes / 1024).toFixed(1)}KB /{" "}
          {MAX_SOURCE_BYTES / 1000}KB
        </p>
        {error}
      </div>

      {pine && (
        <div className="flex flex-wrap gap-2 text-xs" data-testid="pine-meta">
          <Badge tone="accent">Pine v{pine.version ?? "?"}</Badge>
          <Badge>{pine.kind ?? t("No declaration", "선언 없음")}</Badge>
          {pine.title && <Badge>{pine.title}</Badge>}
          <Badge>{t(`${pine.inputs} inputs`, `입력 ${pine.inputs}개`)}</Badge>
          <Badge>{t(`${pine.alerts} alerts`, `알림 ${pine.alerts}개`)}</Badge>
          <Badge>{t(`${pine.orders} order calls`, `주문 함수 ${pine.orders}개`)}</Badge>
        </div>
      )}
      {pine?.kind === "indicator" && (
        <Notice tone="info">
          {t(
            <>
              indicator() scripts only generate signals and don&apos;t place orders. To automate them you need the &lsquo;external signal
              webhook&rsquo; execution mode, which sends TradingView alerts (alertcondition) to the platform webhook (Phase 2).
            </>,
            <>
              indicator() 스크립트는 신호만 만들고 주문을 내지 않습니다. 자동매매로 연결하려면 TradingView 알림(alertcondition)을 플랫폼 Webhook으로 보내는
              &lsquo;외부 신호 Webhook&rsquo; 실행 방식이 필요합니다(Phase 2).
            </>,
          )}
        </Notice>
      )}
      {secrets.length > 0 && (
        <Notice tone="down">
          {t(
            `This looks like it contains secrets: ${secrets.map((s) => L(s)).join(", ")}. Remove keys and seeds before attaching — it can't be saved like this.`,
            `비밀값으로 보이는 내용이 있습니다: ${secrets.map((s) => L(s)).join(", ")}. 키·시드는 지우고 첨부하세요 — 이 상태로는 저장되지 않습니다.`,
          )}
        </Notice>
      )}

      <fieldset className="space-y-1">
        <legend className="text-[13px] text-muted">{t("Visibility", "공개 범위")}</legend>
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="radio" name="src-vis" checked={value.visibility === "PRIVATE"} onChange={() => onChange({ ...value, visibility: "PRIVATE" })} />
          {t("Private — only you and review admins can see it (recommended)", "비공개 — 본인과 심사 관리자만 볼 수 있음 (권장)")}
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="radio" name="src-vis" checked={value.visibility === "PUBLIC"} onChange={() => onChange({ ...value, visibility: "PUBLIC" })} />
          {t("Public — anyone can see it on the bot page", "공개 — 봇 페이지에서 누구나 볼 수 있음")}
        </label>
      </fieldset>
      <p className="text-[11px] text-faint">
        {t(
          "Code is kept per version, and changing the code of a live bot sends it back to review. The platform never runs attached code on its servers.",
          "코드는 버전별로 보관되며, 운영 중인 봇의 코드를 바꾸면 다시 심사를 받습니다. 플랫폼은 첨부한 코드를 서버에서 실행하지 않습니다.",
        )}
      </p>
    </div>
  );
}
