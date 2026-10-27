"use client";

import { useState } from "react";
import { SOURCE_LANGUAGE_LABELS, type SourceMeta } from "@/lib/bots/source";
import { Badge, buttonClass } from "./ui";

/** Strategy source on the bot page. Code is rendered as plain escaped text, never run. */
export function BotSourcePanel({ meta, code }: { meta: SourceMeta; code: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3" data-testid="bot-source">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="accent">{SOURCE_LANGUAGE_LABELS[meta.language]}</Badge>
        {meta.pine?.version && <Badge>Pine v{meta.pine.version}</Badge>}
        {meta.pine?.kind && <Badge>{meta.pine.kind}</Badge>}
        {meta.pine && <Badge>입력 {meta.pine.inputs} · 알림 {meta.pine.alerts} · 주문 {meta.pine.orders}</Badge>}
        <Badge tone={meta.visibility === "PUBLIC" ? "up" : "neutral"}>{meta.visibility === "PUBLIC" ? "공개" : "비공개"}</Badge>
        <span className="num text-faint">
          {meta.lines}줄 · sha256 {meta.sha256.slice(0, 12)}…
        </span>
      </div>
      {meta.pine?.title && <p className="text-sm">{meta.pine.title}</p>}
      {code === null ? (
        <p className="text-sm text-muted">개발자가 소스코드를 비공개로 설정했습니다. 심사 관리자만 확인할 수 있습니다.</p>
      ) : (
        <>
          <div className="flex gap-2">
            <button className={buttonClass("secondary", "sm")} onClick={() => setOpen((o) => !o)}>
              {open ? "코드 접기" : "코드 보기"}
            </button>
            <button
              className={buttonClass("ghost", "sm")}
              onClick={async () => {
                await navigator.clipboard.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "복사됨" : "복사"}
            </button>
          </div>
          {open && (
            <pre className="max-h-[480px] overflow-auto rounded-lg border border-line bg-black/40 p-3 text-[11px] leading-relaxed text-text/90">
              <code>{code}</code>
            </pre>
          )}
        </>
      )}
      <p className="text-[11px] text-faint">플랫폼은 이 코드를 실행하지 않습니다. 실거래 성과는 플랫폼 주문 체결만으로 집계됩니다.</p>
    </div>
  );
}
