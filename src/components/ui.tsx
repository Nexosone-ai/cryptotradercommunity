import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-line bg-panel p-4 sm:p-5", className)}>{children}</div>;
}

export function SectionTitle({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
        {desc && <p className="mt-1 text-sm text-muted">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

const BADGE_TONES = {
  neutral: "border-line-strong text-muted",
  accent: "border-accent/40 text-accent bg-accent/10",
  up: "border-up/40 text-up bg-up/10",
  down: "border-down/40 text-down bg-down/10",
  warn: "border-warn/40 text-warn bg-warn/10",
  blue: "border-accent-2/40 text-accent-2 bg-accent-2/10",
} as const;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", BADGE_TONES[tone])}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("num mt-1 text-base font-semibold", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {desc && <p className="mx-auto mt-2 max-w-md text-sm text-muted">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const BUTTON = {
  primary: "bg-accent text-black hover:bg-accent/90",
  secondary: "border border-line-strong bg-panel-2 text-text hover:border-accent/60",
  danger: "border border-down/50 text-down hover:bg-down/10",
  ghost: "text-muted hover:text-text",
} as const;

export function buttonClass(variant: keyof typeof BUTTON = "primary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm",
    BUTTON[variant],
  );
}

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: keyof typeof BUTTON }) {
  return (
    <Link href={href} className={buttonClass(variant)}>
      {children}
    </Link>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "info" | "down"; children: ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-lg border px-3 py-2.5 text-sm",
        tone === "warn" && "border-warn/40 bg-warn/10 text-warn",
        tone === "info" && "border-accent-2/40 bg-accent-2/10 text-[#9cc2ff]",
        tone === "down" && "border-down/40 bg-down/10 text-[#ff9a9a]",
      )}
    >
      {children}
    </div>
  );
}
