"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, buttonClass, Card, cx, Notice, Stat } from "@/components/ui";
import { apiFetch } from "@/lib/client-api";
import { dateTime, feeLabel, RISK_LABELS, shortAddress, STATUS_LABELS } from "@/lib/format";
import { SwapAdmin } from "./SwapAdmin";

const TABS = [
  ["review", "봇 심사"],
  ["revenue", "수익·정산"],
  ["payouts", "지급"],
  ["policy", "수수료 정책"],
  ["swap", "스왑 컨트랙트"],
  ["system", "시스템·위험"],
  ["audit", "감사 로그"],
] as const;
type Tab = (typeof TABS)[number][0];

const usdc = (e8: string | number | bigint) => {
  const n = Number(BigInt(e8 as string)) / 1e8;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 8 })} USDC`;
};

export function AdminConsole({ adminId }: { adminId: string }) {
  const [tab, setTab] = useState<Tab>("review");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">관리자</h1>
      <div className="flex flex-wrap gap-1 border-b border-line pb-2">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx("rounded-md px-3 py-1.5 text-sm", tab === k ? "bg-panel-2 text-text" : "text-muted")}>
            {l}
          </button>
        ))}
      </div>
      {tab === "review" && <Review adminId={adminId} />}
      {tab === "revenue" && <Revenue />}
      {tab === "payouts" && <Payouts />}
      {tab === "policy" && <Policy />}
      {tab === "swap" && <SwapAdmin />}
      {tab === "system" && <SystemTab />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function useLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    apiFetch<T>(url)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [url]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function useMutate(after: () => void) {
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (url: string, body: unknown, ok = "완료") => {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(url, { method: "POST", body });
      setMsg({ tone: "info", text: ok });
      after();
    } catch (e) {
      setMsg({ tone: "down", text: e instanceof Error ? e.message : "실패" });
    } finally {
      setBusy(false);
    }
  };
  return { msg, busy, run };
}

interface PendingBot {
  id: string;
  slug: string;
  name: string;
  status: string;
  ownerUserId: string;
  ownerWalletAddress: string;
  feeTenthsBp: number;
  riskLevel: string;
  strategyType: string;
  updatedAt: string;
  risk: { findings: { severity: string; code: string; message: string }[] };
}

function Review({ adminId }: { adminId: string }) {
  const { data, error, reload } = useLoad<{ bots: PendingBot[] }>("/api/admin/bots/pending");
  const m = useMutate(reload);
  const [reason, setReason] = useState<Record<string, string>>({});
  if (error) return <Notice tone="down">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">불러오는 중…</p>;
  return (
    <div className="space-y-3">
      {m.msg && <Notice tone={m.msg.tone}>{m.msg.text}</Notice>}
      {!data.bots.length && <p className="text-sm text-muted">심사 대기 중인 봇이 없습니다.</p>}
      {data.bots.map((b) => (
        <Card key={b.id} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/bots/${b.slug}`} className="font-semibold hover:text-accent" target="_blank">
              {b.name} ↗
            </Link>
            <Badge>{STATUS_LABELS[b.status]}</Badge>
            <Badge tone={b.riskLevel === "LOW" ? "up" : b.riskLevel === "MEDIUM" ? "warn" : "down"}>{RISK_LABELS[b.riskLevel]}</Badge>
            <span className="num text-xs text-muted">
              {shortAddress(b.ownerWalletAddress)} · {b.strategyType} · 수수료 {feeLabel(b.feeTenthsBp)} · {dateTime(b.updatedAt)}
            </span>
          </div>
          {b.risk.findings.length > 0 && (
            <ul className="space-y-1 text-xs">
              {b.risk.findings.map((f) => (
                <li key={f.code} className={f.severity === "BLOCK" ? "text-down" : "text-warn"}>
                  [{f.severity}] {f.message}
                </li>
              ))}
            </ul>
          )}
          {b.ownerUserId === adminId ? (
            <p className="text-xs text-warn">본인 봇은 심사할 수 없습니다 (이해충돌).</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                placeholder="반려·중단 사유 (필수)"
                value={reason[b.id] ?? ""}
                onChange={(e) => setReason({ ...reason, [b.id]: e.target.value })}
                className="max-w-sm"
              />
              {b.status === "SUBMITTED" && (
                <button className={buttonClass("secondary", "sm")} disabled={m.busy} onClick={() => m.run(`/api/admin/bots/${b.id}/review`, { decision: "START_REVIEW" })}>
                  심사 시작
                </button>
              )}
              <button className={buttonClass("primary", "sm")} disabled={m.busy} onClick={() => m.run(`/api/admin/bots/${b.id}/approve`, {}, "승인했습니다")}>
                승인
              </button>
              <button
                className={buttonClass("danger", "sm")}
                disabled={m.busy || !reason[b.id]}
                onClick={() => m.run(`/api/admin/bots/${b.id}/reject`, { reason: reason[b.id] }, "반려했습니다")}
              >
                반려
              </button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

interface LedgerData {
  overview: {
    report: Record<string, string> & { issues: string[] };
    observedE8: string;
    observedCount: number;
    hlRewards: { builderRewards: string; unclaimedRewards: string; claimedRewards: string } | null;
    hlError: string | null;
  };
  events: { ev: { id: string; status: string; amountE8: string; rawAmount: string; occurredAt: string; tier1PartnerUserId: string | null; tier2PartnerUserId: string | null }; botName: string | null; trader: string }[];
}

function Revenue() {
  const { data, error, reload } = useLoad<LedgerData>("/api/admin/fees/ledger");
  const m = useMutate(reload);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [claim, setClaim] = useState({ amountUsdc: "", reference: "" });
  if (error) return <Notice tone="down">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">불러오는 중…</p>;
  const r = data.overview.report;
  const observed = data.events.filter((e) => e.ev.status === "OBSERVED");
  return (
    <div className="space-y-6">
      {m.msg && <Notice tone={m.msg.tone}>{m.msg.text}</Notice>}
      {r.issues.length > 0 ? (
        <Notice tone="down">원장 대사 불일치: {r.issues.join(" / ")}</Notice>
      ) : (
        <Notice tone="info">원장 대사 정상 — 배분 + 지급 = 확정 수익, 모든 분개 차대 일치.</Notice>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="확정 Builder 수익 (누적)" value={usdc(r.allocatedRevenueE8)} />
        <Stat label="확인 대기 (OBSERVED)" value={usdc(data.overview.observedE8)} hint={`${data.overview.observedCount}건 · 배분 전`} />
        <Stat label="플랫폼 최종 수익" value={usdc(r.platformNetE8)} />
        <Stat label="미배정 파트너 예비금" value={usdc(r.unallocatedReserveE8)} hint="플랫폼 순이익과 별도" />
        <Stat label="봇 등록자 미지급" value={usdc(r.ownerPayableE8)} />
        <Stat label="파트너 미지급" value={usdc(r.partnerPayableE8)} />
        <Stat label="지급 완료" value={usdc(r.paidOutE8)} />
        <Stat label="반올림 잔여" value={usdc(r.roundingE8)} />
        <Stat label="Builder 미수금 (장부)" value={usdc(r.receivableE8)} />
        <Stat label="청구 완료 잔액 (장부)" value={usdc(r.platformHlBalanceE8)} />
        <Stat
          label="HL 보고 미청구 Builder 보상"
          value={data.overview.hlRewards ? `${data.overview.hlRewards.unclaimedRewards} USDC` : "—"}
          hint={data.overview.hlError ?? "Hyperliquid info.referral(builder)"}
        />
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">체결 동기화 · 수익 확정</h2>
          <button className={buttonClass("secondary", "sm")} disabled={m.busy} onClick={() => m.run("/api/admin/fees/sync", {}, "Hyperliquid 체결을 동기화했습니다")}>
            Hyperliquid 체결 동기화
          </button>
        </div>
        <p className="text-xs text-muted">
          확정 전 Hyperliquid의 Builder 보상(위 HL 보고 값, builder_fills CSV)과 확인 대기 합계를 대조하세요. 확정된 이벤트만 70/30 배분 원장에 기록됩니다.
        </p>
        {observed.length === 0 ? (
          <p className="text-sm text-muted">확인 대기 이벤트가 없습니다.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1">
                      <input
                        type="checkbox"
                        checked={selected.length === observed.length}
                        onChange={(e) => setSelected(e.target.checked ? observed.map((o) => o.ev.id) : [])}
                      />
                    </th>
                    <th>체결 시각</th>
                    <th>봇</th>
                    <th>트레이더</th>
                    <th className="text-right">Builder Fee</th>
                    <th>추천</th>
                  </tr>
                </thead>
                <tbody className="num divide-y divide-line">
                  {observed.map(({ ev, botName, trader }) => (
                    <tr key={ev.id}>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.includes(ev.id)}
                          onChange={(e) => setSelected(e.target.checked ? [...selected, ev.id] : selected.filter((x) => x !== ev.id))}
                        />
                      </td>
                      <td>{dateTime(ev.occurredAt)}</td>
                      <td className="font-sans">{botName ?? "수동 주문"}</td>
                      <td>{shortAddress(trader)}</td>
                      <td className="text-right">{ev.rawAmount}</td>
                      <td>{ev.tier1PartnerUserId ? (ev.tier2PartnerUserId ? "1·2차" : "1차") : "없음 → 예비금"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <input placeholder="대사 근거 (예: HL referral 보상 12.3 USDC와 일치)" value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-md" />
              <button
                className={buttonClass("primary", "sm")}
                disabled={m.busy || !selected.length || !reason}
                onClick={() => m.run("/api/admin/fees/confirm", { eventIds: selected, reason }, `${selected.length}건 확정·배분`).then(() => setSelected([]))}
              >
                선택 {selected.length}건 확정·배분
              </button>
            </div>
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Builder 보상 청구(claim) 기록</h2>
        <p className="text-xs text-muted">Hyperliquid에서 Builder 보상을 청구한 뒤 금액과 참조(tx/시각)를 기록합니다. 지급은 청구 기록된 잔액 이내에서만 완료 처리됩니다.</p>
        <div className="flex flex-wrap gap-2">
          <input placeholder="금액 (USDC)" value={claim.amountUsdc} onChange={(e) => setClaim({ ...claim, amountUsdc: e.target.value })} className="max-w-40" />
          <input placeholder="참조" value={claim.reference} onChange={(e) => setClaim({ ...claim, reference: e.target.value })} className="max-w-xs" />
          <button className={buttonClass("secondary", "sm")} disabled={m.busy || !claim.amountUsdc || !claim.reference} onClick={() => m.run("/api/admin/fees/claims", claim, "청구를 기록했습니다")}>
            기록
          </button>
        </div>
      </Card>
    </div>
  );
}

interface PayoutsData {
  payouts: { p: { id: string; status: string; amountE8: string; account: string; createdAt: string; txHash: string | null; createdBy: string }; wallet: string }[];
  payables: { userId: string; account: string; wallet: string; owed: string }[];
}

function Payouts() {
  const { data, error, reload } = useLoad<PayoutsData>("/api/admin/payouts");
  const m = useMutate(reload);
  const [tx, setTx] = useState<Record<string, string>>({});
  if (error) return <Notice tone="down">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">불러오는 중…</p>;
  return (
    <div className="space-y-6">
      {m.msg && <Notice tone={m.msg.tone}>{m.msg.text}</Notice>}
      <Notice>자동 송금은 비활성화되어 있습니다. 승인 후 운영자가 직접 송금하고 트랜잭션 해시로 완료 처리합니다.</Notice>
      <Card>
        <h2 className="mb-3 font-semibold">미지급 잔액</h2>
        {data.payables.length === 0 ? (
          <p className="text-sm text-muted">미지급 잔액이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="num divide-y divide-line">
              {data.payables.map((p) => (
                <tr key={p.userId + p.account}>
                  <td className="py-2">{shortAddress(p.wallet)}</td>
                  <td>{p.account === "BOT_OWNER_PAYABLE" ? "봇 등록자" : "파트너"}</td>
                  <td className="text-right">{usdc(p.owed)}</td>
                  <td className="text-right">
                    <button
                      className={buttonClass("secondary", "sm")}
                      disabled={m.busy}
                      onClick={() => m.run("/api/admin/payouts", { recipientUserId: p.userId, account: p.account }, "지급 요청을 만들었습니다")}
                    >
                      지급 요청 생성
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">지급 내역</h2>
        {data.payouts.length === 0 ? (
          <p className="text-sm text-muted">지급 요청이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <tbody className="num divide-y divide-line">
                {data.payouts.map(({ p, wallet }) => (
                  <tr key={p.id}>
                    <td className="py-2">{dateTime(p.createdAt)}</td>
                    <td>{shortAddress(wallet)}</td>
                    <td>{usdc(p.amountE8)}</td>
                    <td>
                      <Badge tone={p.status === "PAID" ? "up" : p.status === "APPROVED" ? "blue" : "warn"}>{p.status}</Badge>
                    </td>
                    <td className="text-right">
                      {p.status === "PENDING_APPROVAL" && (
                        <button className={buttonClass("primary", "sm")} disabled={m.busy} onClick={() => m.run(`/api/admin/payouts/${p.id}/approve`, {}, "승인했습니다")}>
                          승인
                        </button>
                      )}
                      {p.status === "APPROVED" && (
                        <span className="inline-flex gap-2">
                          <input placeholder="0x… tx hash" value={tx[p.id] ?? ""} onChange={(e) => setTx({ ...tx, [p.id]: e.target.value })} className="w-56" />
                          <button className={buttonClass("secondary", "sm")} disabled={m.busy || !tx[p.id]} onClick={() => m.run(`/api/admin/payouts/${p.id}/paid`, { txHash: tx[p.id] }, "지급 완료로 기록했습니다")}>
                            완료 기록
                          </button>
                        </span>
                      )}
                      {p.txHash && <span className="text-xs text-muted">{shortAddress(p.txHash)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

interface PolicyRow {
  id: string;
  version: number;
  botOwnerSharePpm: number;
  platformShareOfPoolPpm: number;
  tier1ShareOfPartnerPoolPpm: number;
  effectiveFrom: string;
  note: string | null;
}

function Policy() {
  const { data, error, reload } = useLoad<{ policies: PolicyRow[] }>("/api/admin/fees/policy");
  const m = useMutate(reload);
  const [f, setF] = useState({ owner: "70", platform: "20", tier1: "60", effectiveFrom: "", note: "" });
  if (error) return <Notice tone="down">{error}</Notice>;
  const pct = (ppm: number) => `${ppm / 10_000}%`;
  const toPpm = (v: string) => Math.round(Number(v) * 10_000);
  const o = Number(f.owner) / 100;
  const p = Number(f.platform) / 100;
  const t = Number(f.tier1) / 100;
  return (
    <div className="space-y-6">
      {m.msg && <Notice tone={m.msg.tone}>{m.msg.text}</Notice>}
      <Card>
        <h2 className="mb-3 font-semibold">정책 버전</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1">버전</th>
              <th>봇 등록자</th>
              <th>풀 → 플랫폼</th>
              <th>파트너 → 1차</th>
              <th>시행</th>
              <th>메모</th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-line">
            {data?.policies.map((x) => (
              <tr key={x.id}>
                <td className="py-1.5">v{x.version}</td>
                <td>{pct(x.botOwnerSharePpm)}</td>
                <td>{pct(x.platformShareOfPoolPpm)}</td>
                <td>{pct(x.tier1ShareOfPartnerPoolPpm)}</td>
                <td>{dateTime(x.effectiveFrom)}</td>
                <td className="font-sans text-xs text-muted">{x.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">새 정책 버전 (미래 시점부터 적용, 소급 불가)</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label>봇 등록자 몫 (%)</label>
            <input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} />
          </div>
          <div>
            <label>관리자 풀 중 플랫폼 (%)</label>
            <input value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} />
          </div>
          <div>
            <label>파트너 풀 중 1차 (%)</label>
            <input value={f.tier1} onChange={(e) => setF({ ...f, tier1: e.target.value })} />
          </div>
          <div>
            <label>시행 시각</label>
            <input type="datetime-local" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label>변경 사유</label>
            <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </div>
        </div>
        <p className="num text-xs text-muted">
          결과: 등록자 {(o * 100).toFixed(2)}% · 플랫폼 {((1 - o) * p * 100).toFixed(2)}% · 1차 {((1 - o) * (1 - p) * t * 100).toFixed(2)}% · 2차{" "}
          {((1 - o) * (1 - p) * (1 - t) * 100).toFixed(2)}% (합계 100%)
        </p>
        <button
          className={buttonClass("primary", "sm")}
          disabled={m.busy || !f.effectiveFrom || !f.note}
          onClick={() =>
            m.run(
              "/api/admin/fees/policy",
              {
                botOwnerSharePpm: toPpm(f.owner),
                platformShareOfPoolPpm: toPpm(f.platform),
                tier1ShareOfPartnerPoolPpm: toPpm(f.tier1),
                effectiveFrom: new Date(f.effectiveFrom).toISOString(),
                note: f.note,
              },
              "정책 버전을 생성했습니다",
            )
          }
        >
          정책 버전 생성
        </button>
      </Card>
    </div>
  );
}

function SystemTab() {
  const { data, error } = useLoad<{ status: Record<string, unknown>; riskEvents: { id: string; kind: string; severity: string; createdAt: string; detail: unknown }[] }>(
    "/api/admin/system",
  );
  if (error) return <Notice tone="down">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">불러오는 중…</p>;
  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-3 font-semibold">시스템 상태</h2>
        <pre className="num overflow-x-auto text-xs text-muted">{JSON.stringify(data.status, null, 2)}</pre>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">위험 이벤트 (최근 100건)</h2>
        {data.riskEvents.length === 0 ? (
          <p className="text-sm text-muted">기록된 위험 이벤트가 없습니다.</p>
        ) : (
          <ul className="num space-y-1 text-xs">
            {data.riskEvents.map((e) => (
              <li key={e.id} className={e.severity === "WARN" ? "text-warn" : "text-muted"}>
                {dateTime(e.createdAt)} · {e.kind} · {JSON.stringify(e.detail)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Audit() {
  const { data, error } = useLoad<{ rows: { id: string; seq: number; action: string; actorWallet: string | null; targetType: string | null; targetId: string | null; reason: string | null; createdAt: string; hash: string }[]; brokenAt: string | null }>(
    "/api/admin/audit-logs",
  );
  if (error) return <Notice tone="down">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">불러오는 중…</p>;
  return (
    <div className="space-y-3">
      {data.brokenAt ? <Notice tone="down">감사 로그 해시 체인 불일치: {data.brokenAt}</Notice> : <Notice tone="info">감사 로그 해시 체인 검증 정상 (append-only)</Notice>}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] text-xs">
          <tbody className="num divide-y divide-line">
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-1.5">#{r.seq}</td>
                <td>{dateTime(r.createdAt)}</td>
                <td className="font-sans font-semibold">{r.action}</td>
                <td>{r.actorWallet ? shortAddress(r.actorWallet) : "—"}</td>
                <td>
                  {r.targetType}:{r.targetId?.slice(0, 8)}
                </td>
                <td className="font-sans text-muted">{r.reason}</td>
                <td className="text-faint">{r.hash.slice(0, 10)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
