"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, buttonClass, Card, cx, Notice, Stat } from "@/components/ui";
import { apiFetch, ClientApiError } from "@/lib/client-api";
import { dateTime } from "@/lib/format";
import { formatUsdcE8 } from "@/lib/money";

const usd = (e8: string | bigint | null | undefined) => (e8 === null || e8 === undefined ? "—" : `$${formatUsdcE8(BigInt(e8))}`);

interface Topup {
  id: string;
  requestedE8: string;
  approvedE8: string | null;
  referenceCode: string;
  status: string;
  note: string | null;
  fxRate: string | null;
  fxSource: string | null;
  krwSupply: string | null;
  krwVat: string | null;
  krwTotal: string | null;
  createdAt: string;
}
interface Job {
  id: string;
  status: string;
  resolution: string;
  clipSeconds: number;
  clipCount: number;
  priceE8: string;
  refundedE8: string;
  description: string | null;
  error: string | null;
  createdAt: string;
}
interface Output {
  id: string;
  idx: number;
  prompt: string;
  status: string;
  videoUrl: string | null;
  error: string | null;
}
interface Invoice {
  id: string;
  jobId: string | null;
  issuerName: string;
  customerName: string;
  description: string;
  amountE8: string;
  publicToken: string;
  referenceCode: string;
  status: string;
  createdAt: string;
}
interface Summary {
  creditE8: string;
  invoicePayableE8: string;
  topups: Topup[];
  settlements: { id: string; amountE8: string; bankReference: string; createdAt: string }[];
  jobs: Job[];
  invoices: Invoice[];
  settings: { falConfigured: boolean; markupPpm: number; companyConfigured: boolean };
}
type Msg = { tone: "info" | "down"; text: string } | null;

const TABS = [
  ["video", "영상 생성"],
  ["credit", "크레딧"],
  ["invoice", "고객 청구서"],
  ["earnings", "정산금"],
] as const;

export function PartnerServices() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("video");
  const [data, setData] = useState<Summary | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    apiFetch<Summary>("/api/partner/services")
      .then(setData)
      .catch((e) => setMsg({ tone: "down", text: e.message }));
  }, [tick]);

  if (!data) return <p className="text-sm text-muted">불러오는 중…</p>;
  return (
    <section className="space-y-4" data-testid="partner-services">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">영상 서비스 · 청구</h2>
        <div className="flex gap-3 text-sm">
          <span>
            크레딧 <b className="num text-accent">{usd(data.creditE8)}</b>
          </span>
          <span>
            미지급 정산금 <b className="num">{usd(data.invoicePayableE8)}</b>
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line pb-2" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("rounded-md px-3 py-1.5 text-sm", tab === k ? "bg-panel-2" : "text-muted")}>
            {l}
          </button>
        ))}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {tab === "video" && <VideoTab data={data} onChange={reload} setMsg={setMsg} />}
      {tab === "credit" && <CreditTab data={data} onChange={reload} setMsg={setMsg} />}
      {tab === "invoice" && <InvoiceTab data={data} onChange={reload} setMsg={setMsg} />}
      {tab === "earnings" && <EarningsTab data={data} />}
    </section>
  );
}

function VideoTab({ data, onChange, setMsg }: { data: Summary; onChange: () => void; setMsg: (m: Msg) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [resolution, setResolution] = useState<"480P" | "768P">("480P");
  const [seconds, setSeconds] = useState(5);
  const [brief, setBrief] = useState("");
  const [rights, setRights] = useState(false);
  const [quote, setQuote] = useState<{ priceE8: string; costE8: string } | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ quote: { priceE8: string; costE8: string } }>(`/api/partner/video/quote?resolution=${resolution}&seconds=${seconds}`)
      .then((d) => setQuote(d.quote))
      .catch(() => setQuote(null));
  }, [resolution, seconds]);

  async function submit() {
    if (!file) return;
    try {
      setStep("업로드 준비…");
      const up = await apiFetch<{ uploadUrl: string; fileUrl: string }>("/api/partner/video/upload-url", {
        method: "POST",
        body: { contentType: file.type, fileName: file.name, size: file.size },
      });
      setStep("영상 업로드 중…");
      const put = await fetch(up.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error(`업로드 실패 (${put.status})`);
      setStep("영상 분석 및 10개 생성 요청 중… (최대 1~2분)");
      const r = await apiFetch<{ job: Job }>("/api/partner/video/jobs", {
        method: "POST",
        body: { sourceVideoUrl: up.fileUrl, resolution, clipSeconds: seconds, brief, rightsConfirmed: rights },
      });
      setMsg({ tone: "info", text: "생성을 시작했습니다. 영상 하나당 몇 분 걸리며, 아래 작업 목록에서 진행 상황을 볼 수 있습니다." });
      setOpenJob(r.job.id);
      setFile(null);
      onChange();
    } catch (e) {
      setMsg({ tone: "down", text: e instanceof ClientApiError || e instanceof Error ? e.message : "실패" });
    } finally {
      setStep(null);
    }
  }

  const enough = quote ? BigInt(data.creditE8) >= BigInt(quote.priceE8) : false;
  return (
    <div className="space-y-6">
      {!data.settings.falConfigured && <Notice>영상 생성 서비스(fal.ai)가 아직 설정되지 않았습니다. 운영자가 FAL_KEY를 설정하면 활성화됩니다.</Notice>}
      <Card className="space-y-4">
        <h3 className="font-semibold">영상 1개 → 비슷한 영상 10개</h3>
        <div>
          <label htmlFor="vfile">원본 영상 (mp4 / mov / webm, 최대 80MB)</label>
          <input id="vfile" type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="vres">해상도</label>
            <select id="vres" value={resolution} onChange={(e) => setResolution(e.target.value as "480P" | "768P")}>
              <option value="480P">480p</option>
              <option value="768P">768p</option>
            </select>
          </div>
          <div>
            <label htmlFor="vsec">영상 길이 (각)</label>
            <select id="vsec" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
              <option value={5}>5초</option>
              <option value={10}>10초</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="vbrief">요청 사항 (선택)</label>
          <textarea id="vbrief" rows={2} maxLength={1000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="예: 밝은 분위기, 제품을 중심으로" />
        </div>
        <p className="num text-sm">
          이용료: <b className="text-accent">{quote ? usd(quote.priceE8) : "—"}</b>{" "}
          <span className="text-xs text-muted">(fal.ai 정가 기준 원가 {quote ? usd(quote.costE8) : "—"} × {(data.settings.markupPpm / 1_000_000).toFixed(2)}) · 실패한 영상은 자동 환불</span>
        </p>
        <label className="flex items-start gap-2 text-sm text-text">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1" />
          업로드하는 영상과 그 안의 인물·음악·상표를 사용할 권리가 있으며, 생성된 영상에 수익 보장 등 허위·과장 표현을 넣지 않겠습니다.
        </label>
        {!enough && quote && <p className="text-xs text-warn">크레딧이 부족합니다. 크레딧 탭에서 충전하세요.</p>}
        {step && <p className="text-sm text-accent">{step}</p>}
        <button className={buttonClass("primary")} disabled={!file || !rights || !enough || !data.settings.falConfigured || Boolean(step)} onClick={submit}>
          10개 생성 시작
        </button>
      </Card>

      <div className="space-y-2">
        <h3 className="font-semibold">작업 목록</h3>
        {data.jobs.length === 0 ? (
          <p className="text-sm text-muted">아직 작업이 없습니다.</p>
        ) : (
          data.jobs.map((j) => (
            <Card key={j.id} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  {dateTime(j.createdAt)} · {j.resolution} · {j.clipSeconds}초 × {j.clipCount}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={j.status === "COMPLETED" ? "up" : j.status === "FAILED" ? "down" : j.status === "PARTIAL" ? "warn" : "accent"}>{j.status}</Badge>
                  <span className="num text-xs text-muted">
                    {usd(j.priceE8)}
                    {BigInt(j.refundedE8) > 0n && ` (환불 ${usd(j.refundedE8)})`}
                  </span>
                  <button className={buttonClass("secondary", "sm")} onClick={() => setOpenJob(openJob === j.id ? null : j.id)}>
                    {openJob === j.id ? "닫기" : "보기"}
                  </button>
                </span>
              </div>
              {j.error && <p className="text-xs text-down">{j.error}</p>}
              {openJob === j.id && <JobOutputs jobId={j.id} onStatus={onChange} />}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function JobOutputs({ jobId, onStatus }: { jobId: string; onStatus: () => void }) {
  const [outputs, setOutputs] = useState<Output[] | null>(null);
  const [status, setStatus] = useState<string>("");
  useEffect(() => {
    let alive = true;
    let last = "";
    const load = () =>
      apiFetch<{ job: Job; outputs: Output[] }>(`/api/partner/video/jobs/${jobId}`)
        .then((d) => {
          if (!alive) return;
          setOutputs(d.outputs);
          setStatus(d.job.status);
          if (last && last !== d.job.status) onStatus();
          last = d.job.status;
        })
        .catch(() => {});
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [jobId, onStatus]);
  if (!outputs) return <p className="text-sm text-muted">불러오는 중…</p>;
  return (
    <div className="space-y-2">
      {(status === "GENERATING" || status === "ANALYZING") && <p className="text-xs text-muted">생성 중 — 15초마다 자동으로 갱신합니다.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {outputs.map((o) => (
          <div key={o.id} className="space-y-1 rounded-lg border border-line p-2">
            {o.videoUrl ? (
              <video src={o.videoUrl} controls preload="metadata" className="aspect-video w-full rounded bg-black" />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded bg-panel-2 text-xs text-muted">
                {o.status === "FAILED" ? "실패 (환불됨)" : o.status === "IN_PROGRESS" ? "생성 중…" : "대기 중…"}
              </div>
            )}
            <p className="line-clamp-2 text-[11px] text-muted" title={o.prompt}>
              #{o.idx + 1} {o.prompt}
            </p>
            {o.videoUrl && (
              <a href={o.videoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">
                다운로드
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface PackageQuote {
  usd: number;
  creditE8: string;
  supply: string;
  vat: string;
  total: string;
}
interface Packages {
  fx: { rate: string; source: string; asOf: string };
  packages: PackageQuote[];
}
type Bank = { name: string; bankName: string; bankAccount: string; bankHolder: string };

const krw = (v: string | bigint | null | undefined) => (v === null || v === undefined ? "—" : `₩${BigInt(v).toLocaleString("ko-KR")}`);

function CreditTab({ data, onChange, setMsg }: { data: Summary; onChange: () => void; setMsg: (m: Msg) => void }) {
  const [pk, setPk] = useState<Packages | null>(null);
  const [pkErr, setPkErr] = useState<string | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [locked, setLocked] = useState<Topup | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<Packages>("/api/partner/credits")
      .then(setPk)
      .catch((e) => setPkErr(e.message));
  }, []);

  async function buy(usdAmount: number) {
    setBusy(usdAmount);
    try {
      const r = await apiFetch<{ topup: Topup; bank: Bank }>("/api/partner/credits", { method: "POST", body: { packageUsd: usdAmount } });
      setBank(r.bank);
      setLocked(r.topup);
      onChange();
    } catch (e) {
      setMsg({ tone: "down", text: e instanceof Error ? e.message : "실패" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="사용 가능 크레딧" value={usd(data.creditE8)} />
        <Stat label="충전 방식" value="패키지 구매 → 계좌이체 → 관리자 확인" hint="확인 후 크레딧이 들어옵니다" />
      </div>
      {!data.settings.companyConfigured && <Notice>회사 입금 계좌가 아직 설정되지 않아 충전 요청을 할 수 없습니다.</Notice>}
      {pkErr && <Notice tone="down">{pkErr}</Notice>}
      {pk && (
        <>
          <p className="text-xs text-muted">
            적용 환율 <b className="num text-text">1 USD = ₩{Number(pk.fx.rate).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</b> · {pk.fx.source} ·{" "}
            {dateTime(pk.fx.asOf)} 기준 · 원화 금액은 부가세 10% 포함
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="credit-packages">
            {pk.packages.map((x) => (
              <Card key={x.usd} className="flex flex-col gap-2">
                <p className="text-xs text-muted">크레딧</p>
                <p className="num text-2xl font-bold text-accent">${x.usd.toLocaleString("en-US")}</p>
                <dl className="num space-y-0.5 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted">공급가액</dt>
                    <dd>{krw(x.supply)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">부가세 10%</dt>
                    <dd>{krw(x.vat)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-line pt-1 text-sm font-semibold">
                    <dt>결제 금액</dt>
                    <dd>{krw(x.total)}</dd>
                  </div>
                </dl>
                <button className={buttonClass("primary", "sm") + " mt-auto"} disabled={!data.settings.companyConfigured || busy !== null} onClick={() => buy(x.usd)}>
                  {busy === x.usd ? "요청 중…" : "구매 요청"}
                </button>
              </Card>
            ))}
          </div>
        </>
      )}
      {bank && locked && (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm" data-testid="topup-instructions">
          <p className="font-semibold">아래 계좌로 결제 금액을 송금해 주세요. 입금자명(또는 메모)에 참조코드를 꼭 적어주세요.</p>
          <dl className="num mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">참조코드</dt>
            <dd className="font-bold text-accent">{locked.referenceCode}</dd>
            <dt className="text-muted">결제 금액 (VAT 포함)</dt>
            <dd className="font-bold">{krw(locked.krwTotal)}</dd>
            <dt className="text-muted">은행</dt>
            <dd>{bank.bankName}</dd>
            <dt className="text-muted">계좌</dt>
            <dd>{bank.bankAccount}</dd>
            <dt className="text-muted">예금주</dt>
            <dd>{bank.bankHolder}</dd>
          </dl>
          <p className="mt-2 text-xs text-muted">
            환율 1 USD = ₩{locked.fxRate} ({locked.fxSource})로 고정된 금액입니다. 입금이 확인되면 {usd(locked.requestedE8)} 크레딧이 충전됩니다.
          </p>
        </div>
      )}
      <Card>
        <h3 className="mb-2 font-semibold">충전 내역</h3>
        {data.topups.length === 0 ? (
          <p className="text-sm text-muted">충전 내역이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <tbody className="num divide-y divide-line">
                {data.topups.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1.5">{dateTime(t.createdAt)}</td>
                    <td>{t.referenceCode}</td>
                    <td className="text-right">{usd(t.approvedE8 ?? t.requestedE8)}</td>
                    <td className="text-right">{krw(t.krwTotal)}</td>
                    <td className="text-right">
                      <Badge tone={t.status === "APPROVED" ? "up" : t.status === "REJECTED" ? "down" : "warn"}>
                        {{ PENDING: "입금 확인 대기", APPROVED: "충전 완료", REJECTED: "거절" }[t.status] ?? t.status}
                      </Badge>
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

function InvoiceTab({ data, onChange, setMsg }: { data: Summary; onChange: () => void; setMsg: (m: Msg) => void }) {
  const [f, setF] = useState({ issuerName: "", customerName: "", description: "", amountUsd: "", jobId: "" });
  const [copied, setCopied] = useState<string | null>(null);
  const link = (token: string) => `${window.location.origin}/invoice/${token}`;
  const linkable = data.jobs.filter((j) => j.status === "COMPLETED" || j.status === "PARTIAL" || j.status === "GENERATING");
  const job = data.jobs.find((j) => j.id === f.jobId);
  const minimum = job ? BigInt(job.priceE8) - BigInt(job.refundedE8) : null;
  return (
    <div className="space-y-6">
      <Notice tone="info">
        고객은 청구서 링크에 표시된 <b>회사 계좌</b>로 입금합니다. 입금이 확인되면 청구 금액 전액이 정산금으로 적립되고, 회사가 파트너님께 송금합니다. 가격은 파트너님이 정하며, 영상 작업과 연결한 청구서는 그 작업의 이용료보다 낮게 정할 수 없습니다.
      </Notice>
      {!data.settings.companyConfigured && <Notice>회사 입금 계좌가 아직 설정되지 않아 청구서를 만들 수 없습니다.</Notice>}
      <Card className="space-y-3">
        <h3 className="font-semibold">청구서 만들기</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="iissuer">발행자명 (고객에게 표시)</label>
            <input id="iissuer" maxLength={80} value={f.issuerName} onChange={(e) => setF({ ...f, issuerName: e.target.value })} />
          </div>
          <div>
            <label htmlFor="icust">고객명</label>
            <input id="icust" maxLength={80} value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} />
          </div>
          <div>
            <label htmlFor="ijob">연결할 영상 작업 (선택)</label>
            <select id="ijob" value={f.jobId} onChange={(e) => setF({ ...f, jobId: e.target.value })}>
              <option value="">연결 안 함</option>
              {linkable.map((j) => (
                <option key={j.id} value={j.id}>
                  {dateTime(j.createdAt)} · {j.clipCount}개 · 이용료 {usd(BigInt(j.priceE8) - BigInt(j.refundedE8))}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="iamt">청구 금액 (USD){minimum !== null && ` — 최소 ${usd(minimum)}`}</label>
            <input id="iamt" inputMode="decimal" value={f.amountUsd} onChange={(e) => setF({ ...f, amountUsd: e.target.value })} className="num" />
          </div>
        </div>
        <div>
          <label htmlFor="idesc">청구 내역</label>
          <textarea id="idesc" rows={2} maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="예: 홍보 영상 10편 제작" />
        </div>
        <button
          className={buttonClass("primary", "sm")}
          disabled={!data.settings.companyConfigured || !f.issuerName || !f.customerName || !f.description || !f.amountUsd}
          onClick={async () => {
            try {
              await apiFetch("/api/partner/invoices", { method: "POST", body: f });
              setF({ ...f, customerName: "", description: "", amountUsd: "", jobId: "" });
              setMsg({ tone: "info", text: "청구서를 만들었습니다. 아래 목록에서 링크를 복사해 고객에게 보내세요." });
              onChange();
            } catch (e) {
              setMsg({ tone: "down", text: e instanceof Error ? e.message : "실패" });
            }
          }}
        >
          청구서 발행
        </button>
      </Card>
      <Card>
        <h3 className="mb-2 font-semibold">발행한 청구서</h3>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-muted">발행한 청구서가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <tbody className="divide-y divide-line">
                {data.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="num py-2">{dateTime(i.createdAt)}</td>
                    <td>{i.customerName}</td>
                    <td className="num">{i.referenceCode}</td>
                    <td className="num text-right">{usd(i.amountE8)}</td>
                    <td className="text-right">
                      <Badge tone={i.status === "PAID" ? "up" : i.status === "CANCELLED" ? "neutral" : "warn"}>
                        {{ ISSUED: "입금 대기", PAID: "입금 확인", CANCELLED: "취소" }[i.status] ?? i.status}
                      </Badge>
                    </td>
                    <td className="space-x-1 text-right">
                      <button
                        className={buttonClass("secondary", "sm")}
                        onClick={async () => {
                          await navigator.clipboard.writeText(link(i.publicToken));
                          setCopied(i.id);
                          setTimeout(() => setCopied(null), 1500);
                        }}
                      >
                        {copied === i.id ? "복사됨" : "링크 복사"}
                      </button>
                      {i.status === "ISSUED" && (
                        <button
                          className={buttonClass("ghost", "sm")}
                          onClick={async () => {
                            try {
                              await apiFetch(`/api/partner/invoices/${i.id}/cancel`, { method: "POST", body: {} });
                              onChange();
                            } catch (e) {
                              setMsg({ tone: "down", text: e instanceof Error ? e.message : "실패" });
                            }
                          }}
                        >
                          취소
                        </button>
                      )}
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

function EarningsTab({ data }: { data: Summary }) {
  const paid = data.invoices.filter((i) => i.status === "PAID").reduce((s, i) => s + BigInt(i.amountE8), 0n);
  const settled = data.settlements.reduce((s, x) => s + BigInt(x.amountE8), 0n);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="입금 확인된 청구 합계" value={usd(paid)} />
        <Stat label="송금 완료" value={usd(settled)} />
        <Stat label="미지급 정산금" value={usd(data.invoicePayableE8)} hint="회사가 파트너님께 송금할 금액" />
      </div>
      <Card>
        <h3 className="mb-2 font-semibold">송금 내역</h3>
        {data.settlements.length === 0 ? (
          <p className="text-sm text-muted">송금 내역이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="num divide-y divide-line">
              {data.settlements.map((s) => (
                <tr key={s.id}>
                  <td className="py-1.5">{dateTime(s.createdAt)}</td>
                  <td>{s.bankReference}</td>
                  <td className="text-right">{usd(s.amountE8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
