"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { buttonClass, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/client-api";
import type { ReadinessItem } from "@/lib/engine/readiness";

/** What still has to be done before the bot can trade for this subscriber. */
export function ReadinessList({ items }: { items: ReadinessItem[] }) {
  const ready = items.every((i) => i.ok);
  return (
    <div className="space-y-2" data-testid="bot-readiness">
      <p className={`font-semibold ${ready ? "text-up" : "text-warn"}`}>
        {ready ? "Ready — the bot trades for you on its next signal." : "Not trading for you yet — finish the steps below."}
      </p>
      <ul className="space-y-1.5">
        {items.map((i) => (
          <li key={i.key} className="flex gap-2">
            <span className={i.ok ? "text-up" : "text-down"} aria-label={i.ok ? "done" : "to do"}>
              {i.ok ? "✓" : "✗"}
            </span>
            <span>
              <span>{i.label}</span>
              {i.hint && (
                <span className="block text-xs text-muted">
                  {i.hint}{" "}
                  {i.href && (
                    <Link href={i.href} className="text-accent underline">
                      Open
                    </Link>
                  )}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Subscriber's USDC amount per signal. */
export function TradeAmount({ botId, orderUsd, maxOrderUsd, mainnet }: { botId: string; orderUsd: number | null; maxOrderUsd: number; mainnet: boolean }) {
  const { L } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState(String(orderUsd ?? Math.min(100, maxOrderUsd)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          await apiFetch(`/api/bots/${botId}/subscription`, { method: "POST", body: { orderUsd: Number(value) } });
          setMsg({ tone: "info", text: "Saved." });
          router.refresh();
        } catch (err) {
          setMsg({ tone: "down", text: err instanceof Error ? L(err.message) : "Failed" });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-xs text-muted" htmlFor="order-usd">
        Amount per trade (USDC, max {maxOrderUsd}){mainnet ? " — real funds" : ""}
      </label>
      {mainnet && !orderUsd && <p className="text-xs text-warn">Saving an amount lets the bot trade real funds for you on mainnet.</p>}
      <div className="flex gap-2">
        <input id="order-usd" type="number" min={11} max={maxOrderUsd} step={1} value={value} onChange={(e) => setValue(e.target.value)} className="num min-w-0 flex-1" />
        <button type="submit" className={buttonClass("secondary", "sm")} disabled={busy}>
          Save
        </button>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </form>
  );
}

/** Owner of a WEBHOOK_SIGNAL bot: create or rotate the token and see how to send signals. */
export function WebhookSetup({ botId, signalUrl, hasToken, coin }: { botId: string; signalUrl: string; hasToken: boolean; coin: string }) {
  const { L } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const example = JSON.stringify({ token: token ?? "YOUR_TOKEN", action: "{{strategy.market_position}}", coin, id: "{{timenow}}" }, null, 2);
  return (
    <div className="space-y-3 text-sm" data-testid="webhook-setup">
      <div>
        <p className="text-xs text-muted">Webhook URL</p>
        <p className="num break-all">{signalUrl}</p>
      </div>
      {token ? (
        <Notice tone="info">
          <span className="block font-semibold">Copy your token now — it won&apos;t be shown again.</span>
          <span className="num block break-all" data-testid="webhook-token">
            {token}
          </span>
        </Notice>
      ) : (
        <p className="text-muted">{hasToken ? "A token is set. Rotating it stops the old one immediately." : "No token yet. Create one to start sending signals."}</p>
      )}
      <button
        className={buttonClass(hasToken || token ? "secondary" : "primary", "sm")}
        disabled={busy}
        onClick={async () => {
          if ((hasToken || token) && !window.confirm("Replace the token? Alerts using the old token will stop working.")) return;
          setBusy(true);
          setErr(null);
          try {
            const r = await apiFetch<{ token: string }>(`/api/bots/${botId}/webhook-token`, { method: "POST", body: {} });
            setToken(r.token);
          } catch (e) {
            setErr(e instanceof Error ? L(e.message) : "Failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        {hasToken || token ? "Rotate token" : "Create token"}
      </button>
      {err && <Notice tone="down">{err}</Notice>}
      <div>
        <p className="text-xs text-muted">TradingView alert → Notifications → Webhook URL above, message:</p>
        <pre className="num mt-1 overflow-x-auto rounded-md bg-panel-2 p-2 text-xs">{example}</pre>
        <p className="mt-1 text-xs text-muted">
          action: <b>long</b>, <b>short</b> or <b>close</b> (buy / sell / flat also work). The bot holds at most one position per coin;
          a repeated signal is ignored, and an opposite one closes then reverses.
        </p>
      </div>
    </div>
  );
}
