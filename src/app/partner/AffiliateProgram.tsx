"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, buttonClass, Card, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/client-api";
import { dateTime } from "@/lib/format";

export interface AffiliateRow {
  id: string;
  wallet: string;
  status: string;
  clients: number;
  createdAt: string;
}

const pts = (ppm: number) => `${Number((ppm / 10_000).toFixed(2))}%`;

/** Wholesale partner: their portion of the partner share, the affiliate invite link, and their affiliates. */
export function AffiliateProgram({
  portionPpm,
  ownerPpm,
  poolPpm,
  inviteUrl,
  affiliates,
}: {
  portionPpm: number | null;
  /** Bot/copy-trading operator share under the current policy (ppm). */
  ownerPpm: number;
  /** Partner share of each fee under the current policy (ppm of the fee, e.g. 210000 = 21%). */
  poolPpm: number;
  inviteUrl: string | null;
  affiliates: AffiliateRow[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(portionPpm == null ? "" : String(portionPpm / 10_000));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const entered = Number(value);
  const validEntry = value.trim() !== "" && Number.isFinite(entered) && entered >= 0 && entered * 10_000 <= poolPpm;
  const preview = validEntry ? Math.round(entered * 10_000) : portionPpm;

  async function post(url: string, body: unknown, key: string) {
    setBusy(key);
    setMsg(null);
    try {
      await apiFetch(url, { method: "POST", body });
      setMsg({ tone: "info", text: "Saved." });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "down", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid="affiliate-program">
    <Card className="space-y-5">
      <div>
        <h2 className="font-semibold">Affiliate program</h2>
        <p className="mt-1 text-sm text-muted">
          Of each Builder Fee, {pts(ownerPpm)} goes to the bot or copy-trading operator, {pts(1_000_000 - ownerPpm - poolPpm)} to the platform and{" "}
          <b className="text-text">{pts(poolPpm)}</b> to partners. For clients your affiliates bring, you keep your portion and the affiliate gets the rest of
          the {pts(poolPpm)}. For clients you bring yourself, you get all {pts(poolPpm)}.
        </p>
      </div>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (validEntry) void post("/api/partner/program", { portionPct: entered }, "portion");
        }}
      >
        <label className="block text-xs text-muted" htmlFor="portion">
          Your portion (% of each fee, 0–{pts(poolPpm)})
        </label>
        <div className="flex gap-2">
          <input id="portion" type="number" min={0} max={poolPpm / 10_000} step={0.1} value={value} onChange={(e) => setValue(e.target.value)} className="num min-w-0 flex-1" />
          <button type="submit" className={buttonClass("secondary", "sm")} disabled={!validEntry || busy !== null}>
            Save
          </button>
        </div>
        {value.trim() !== "" && !validEntry && <p className="text-xs text-warn">Enter a number from 0 to {poolPpm / 10_000}.</p>}
        {preview != null && (
          <p className="text-xs text-muted" data-testid="portion-example">
            Example on a $100 fee from an affiliate&apos;s client: you ${((Math.min(preview, poolPpm) / 1_000_000) * 100).toFixed(2)} · affiliate $
            {(((poolPpm - Math.min(preview, poolPpm)) / 1_000_000) * 100).toFixed(2)}. A change applies to trades from now on.
          </p>
        )}
      </form>

      <div>
        <p className="text-xs text-muted">Affiliate invite link</p>
        {inviteUrl ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="num rounded bg-panel-2 px-2 py-1 text-xs" data-testid="invite-url">
              {inviteUrl}
            </code>
            <button
              className={buttonClass("secondary", "sm")}
              onClick={() => {
                void navigator.clipboard.writeText(inviteUrl).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-warn">Save your portion first; the invite link appears then.</p>
        )}
        <p className="mt-1 text-xs text-faint">Whoever opens this link and joins becomes your affiliate. Affiliates can&apos;t recruit affiliates of their own.</p>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Your affiliates</h3>
        {affiliates.length === 0 ? (
          <p className="text-sm text-muted">No affiliates yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="affiliate-list">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1">Wallet</th>
                  <th>Clients</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {affiliates.map((a) => (
                  <tr key={a.id} className="border-t border-line">
                    <td className="num py-1.5">{`${a.wallet.slice(0, 6)}…${a.wallet.slice(-4)}`}</td>
                    <td className="num">{a.clients}</td>
                    <td className="num text-muted">{dateTime(a.createdAt)}</td>
                    <td>
                      <Badge tone={a.status === "ACTIVE" ? "up" : "down"}>{a.status}</Badge>
                    </td>
                    <td className="text-right">
                      <button
                        className={buttonClass(a.status === "ACTIVE" ? "danger" : "secondary", "sm")}
                        disabled={busy !== null}
                        onClick={() => post(`/api/partner/affiliates/${a.id}`, { status: a.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }, a.id)}
                      >
                        {a.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1 text-xs text-faint">A suspended affiliate&apos;s share goes to the platform until you reactivate them.</p>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Card>
    </div>
  );
}
