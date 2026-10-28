"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
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
  ["video", "Video generation", "영상 생성"],
  ["credit", "Credits", "크레딧"],
  ["invoice", "Customer invoices", "고객 청구서"],
  ["earnings", "Payouts", "정산금"],
] as const;

export function PartnerServices() {
  const { t, L } = useI18n();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("video");
  const [data, setData] = useState<Summary | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    apiFetch<Summary>("/api/partner/services")
      .then(setData)
      .catch((e) => setMsg({ tone: "down", text: e.message }));
  }, [tick]);

  if (!data) return <p className="text-sm text-muted">{t("Loading…", "불러오는 중…")}</p>;
  return (
    <section className="space-y-4" data-testid="partner-services">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("Video service · Billing", "영상 서비스 · 청구")}</h2>
        <div className="flex gap-3 text-sm">
          <span>
            {t("Credits", "크레딧")} <b className="num text-accent">{usd(data.creditE8)}</b>
          </span>
          <span>
            {t("Unpaid payouts", "미지급 정산금")} <b className="num">{usd(data.invoicePayableE8)}</b>
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line pb-2" role="tablist">
        {TABS.map(([k, en, ko]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("rounded-md px-3 py-1.5 text-sm", tab === k ? "bg-panel-2" : "text-muted")}>
            {t(en, ko)}
          </button>
        ))}
      </div>
      {msg && <Notice tone={msg.tone}>{L(msg.text)}</Notice>}
      {tab === "video" && <VideoTab data={data} onChange={reload} setMsg={setMsg} />}
      {tab === "credit" && <CreditTab data={data} onChange={reload} setMsg={setMsg} />}
      {tab === "invoice" && <InvoiceTab data={data} onChange={reload} setMsg={setMsg} />}
      {tab === "earnings" && <EarningsTab data={data} />}
    </section>
  );
}

function VideoTab({ data, onChange, setMsg }: { data: Summary; onChange: () => void; setMsg: (m: Msg) => void }) {
  const { t, L } = useI18n();
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
      setStep(t("Preparing upload…", "업로드 준비…"));
      const up = await apiFetch<{ uploadUrl: string; fileUrl: string }>("/api/partner/video/upload-url", {
        method: "POST",
        body: { contentType: file.type, fileName: file.name, size: file.size },
      });
      setStep(t("Uploading video…", "영상 업로드 중…"));
      const put = await fetch(up.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error(t(`Upload failed (${put.status})`, `업로드 실패 (${put.status})`));
      setStep(t("Analyzing the video and requesting 10 variations… (up to 1–2 minutes)", "영상 분석 및 10개 생성 요청 중… (최대 1~2분)"));
      const r = await apiFetch<{ job: Job }>("/api/partner/video/jobs", {
        method: "POST",
        body: { sourceVideoUrl: up.fileUrl, resolution, clipSeconds: seconds, brief, rightsConfirmed: rights },
      });
      setMsg({ tone: "info", text: t("Generation started. Each video takes a few minutes; you can follow progress in the job list below.", "생성을 시작했습니다. 영상 하나당 몇 분 걸리며, 아래 작업 목록에서 진행 상황을 볼 수 있습니다.") });
      setOpenJob(r.job.id);
      setFile(null);
      onChange();
    } catch (e) {
      setMsg({ tone: "down", text: e instanceof ClientApiError || e instanceof Error ? L(e.message) : t("Failed", "실패") });
    } finally {
      setStep(null);
    }
  }

  const enough = quote ? BigInt(data.creditE8) >= BigInt(quote.priceE8) : false;
  return (
    <div className="space-y-6">
      {!data.settings.falConfigured && (
        <Notice>
          {t(
            "The video generation service (fal.ai) is not set up yet. It turns on once the operator sets FAL_KEY.",
            "영상 생성 서비스(fal.ai)가 아직 설정되지 않았습니다. 운영자가 FAL_KEY를 설정하면 활성화됩니다.",
          )}
        </Notice>
      )}
      <Card className="space-y-4">
        <h3 className="font-semibold">{t("1 video → 10 similar videos", "영상 1개 → 비슷한 영상 10개")}</h3>
        <div>
          <label htmlFor="vfile">{t("Source video (mp4 / mov / webm, up to 80MB)", "원본 영상 (mp4 / mov / webm, 최대 80MB)")}</label>
          <input id="vfile" type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="vres">{t("Resolution", "해상도")}</label>
            <select id="vres" value={resolution} onChange={(e) => setResolution(e.target.value as "480P" | "768P")}>
              <option value="480P">480p</option>
              <option value="768P">768p</option>
            </select>
          </div>
          <div>
            <label htmlFor="vsec">{t("Length (each)", "영상 길이 (각)")}</label>
            <select id="vsec" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
              <option value={5}>{t("5 s", "5초")}</option>
              <option value={10}>{t("10 s", "10초")}</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="vbrief">{t("Instructions (optional)", "요청 사항 (선택)")}</label>
          <textarea
            id="vbrief"
            rows={2}
            maxLength={1000}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={t("e.g. bright mood, focus on the product", "예: 밝은 분위기, 제품을 중심으로")}
          />
        </div>
        <p className="num text-sm">
          {t("Price:", "이용료:")} <b className="text-accent">{quote ? usd(quote.priceE8) : "—"}</b>{" "}
          <span className="text-xs text-muted">
            {t(
              <>
                (cost at fal.ai list price {quote ? usd(quote.costE8) : "—"} × {(data.settings.markupPpm / 1_000_000).toFixed(2)}) · failed videos are refunded automatically
              </>,
              <>
                (fal.ai 정가 기준 원가 {quote ? usd(quote.costE8) : "—"} × {(data.settings.markupPpm / 1_000_000).toFixed(2)}) · 실패한 영상은 자동 환불
              </>,
            )}
          </span>
        </p>
        <label className="flex items-start gap-2 text-sm text-text">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1" />
          {t(
            "I have the rights to use the uploaded video and the people, music and trademarks in it, and I won't add false or exaggerated claims such as guaranteed returns to the generated videos.",
            "업로드하는 영상과 그 안의 인물·음악·상표를 사용할 권리가 있으며, 생성된 영상에 수익 보장 등 허위·과장 표현을 넣지 않겠습니다.",
          )}
        </label>
        {!enough && quote && (
          <p className="text-xs text-warn">{t("Not enough credits. Top up on the Credits tab.", "크레딧이 부족합니다. 크레딧 탭에서 충전하세요.")}</p>
        )}
        {step && <p className="text-sm text-accent">{step}</p>}
        <button className={buttonClass("primary")} disabled={!file || !rights || !enough || !data.settings.falConfigured || Boolean(step)} onClick={submit}>
          {t("Generate 10 videos", "10개 생성 시작")}
        </button>
      </Card>

      <div className="space-y-2">
        <h3 className="font-semibold">{t("Jobs", "작업 목록")}</h3>
        {data.jobs.length === 0 ? (
          <p className="text-sm text-muted">{t("No jobs yet.", "아직 작업이 없습니다.")}</p>
        ) : (
          data.jobs.map((j) => (
            <Card key={j.id} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  {dateTime(j.createdAt)} · {j.resolution} · {t(`${j.clipSeconds} s`, `${j.clipSeconds}초`)} × {j.clipCount}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={j.status === "COMPLETED" ? "up" : j.status === "FAILED" ? "down" : j.status === "PARTIAL" ? "warn" : "accent"}>{j.status}</Badge>
                  <span className="num text-xs text-muted">
                    {usd(j.priceE8)}
                    {BigInt(j.refundedE8) > 0n && t(` (refunded ${usd(j.refundedE8)})`, ` (환불 ${usd(j.refundedE8)})`)}
                  </span>
                  <button className={buttonClass("secondary", "sm")} onClick={() => setOpenJob(openJob === j.id ? null : j.id)}>
                    {openJob === j.id ? t("Close", "닫기") : t("View", "보기")}
                  </button>
                </span>
              </div>
              {j.error && <p className="text-xs text-down">{L(j.error)}</p>}
              {openJob === j.id && <JobOutputs jobId={j.id} onStatus={onChange} />}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function JobOutputs({ jobId, onStatus }: { jobId: string; onStatus: () => void }) {
  const { t } = useI18n();
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
  if (!outputs) return <p className="text-sm text-muted">{t("Loading…", "불러오는 중…")}</p>;
  return (
    <div className="space-y-2">
      {(status === "GENERATING" || status === "ANALYZING") && (
        <p className="text-xs text-muted">{t("Generating — refreshes automatically every 15 seconds.", "생성 중 — 15초마다 자동으로 갱신합니다.")}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {outputs.map((o) => (
          <div key={o.id} className="space-y-1 rounded-lg border border-line p-2">
            {o.videoUrl ? (
              <video src={o.videoUrl} controls preload="metadata" className="aspect-video w-full rounded bg-black" />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded bg-panel-2 text-xs text-muted">
                {o.status === "FAILED"
                  ? t("Failed (refunded)", "실패 (환불됨)")
                  : o.status === "IN_PROGRESS"
                    ? t("Generating…", "생성 중…")
                    : t("Queued…", "대기 중…")}
              </div>
            )}
            <p className="line-clamp-2 text-[11px] text-muted" title={o.prompt}>
              #{o.idx + 1} {o.prompt}
            </p>
            {o.videoUrl && (
              <a href={o.videoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">
                {t("Download", "다운로드")}
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

const TOPUP_STATUS: Record<string, { en: string; ko: string }> = {
  PENDING: { en: "Awaiting transfer", ko: "입금 확인 대기" },
  APPROVED: { en: "Credited", ko: "충전 완료" },
  REJECTED: { en: "Rejected", ko: "거절" },
};
const INVOICE_STATUS: Record<string, { en: string; ko: string }> = {
  ISSUED: { en: "Awaiting payment", ko: "입금 대기" },
  PAID: { en: "Paid", ko: "입금 확인" },
  CANCELLED: { en: "Cancelled", ko: "취소" },
};

function CreditTab({ data, onChange, setMsg }: { data: Summary; onChange: () => void; setMsg: (m: Msg) => void }) {
  const { t, L } = useI18n();
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
      setMsg({ tone: "down", text: e instanceof Error ? L(e.message) : t("Failed", "실패") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label={t("Available credits", "사용 가능 크레딧")} value={usd(data.creditE8)} />
        <Stat
          label={t("How to top up", "충전 방식")}
          value={t("Buy a package → bank transfer → admin confirms", "패키지 구매 → 계좌이체 → 관리자 확인")}
          hint={t("Credits arrive once the transfer is confirmed", "확인 후 크레딧이 들어옵니다")}
        />
      </div>
      {!data.settings.companyConfigured && (
        <Notice>{t("The company bank account is not set up yet, so you can't request a top-up.", "회사 입금 계좌가 아직 설정되지 않아 충전 요청을 할 수 없습니다.")}</Notice>
      )}
      {pkErr && <Notice tone="down">{L(pkErr)}</Notice>}
      {pk && (
        <>
          <p className="text-xs text-muted">
            {t(
              <>
                Exchange rate <b className="num text-text">1 USD = ₩{Number(pk.fx.rate).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</b> · {L(pk.fx.source)} ·{" "}
                as of {dateTime(pk.fx.asOf)} · KRW amounts include 10% VAT
              </>,
              <>
                적용 환율 <b className="num text-text">1 USD = ₩{Number(pk.fx.rate).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</b> · {L(pk.fx.source)} ·{" "}
                {dateTime(pk.fx.asOf)} 기준 · 원화 금액은 부가세 10% 포함
              </>,
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="credit-packages">
            {pk.packages.map((x) => (
              <Card key={x.usd} className="flex flex-col gap-2">
                <p className="text-xs text-muted">{t("Credits", "크레딧")}</p>
                <p className="num text-2xl font-bold text-accent">${x.usd.toLocaleString("en-US")}</p>
                <dl className="num space-y-0.5 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("Supply price", "공급가액")}</dt>
                    <dd>{krw(x.supply)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("VAT 10%", "부가세 10%")}</dt>
                    <dd>{krw(x.vat)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-line pt-1 text-sm font-semibold">
                    <dt>{t("Total to pay", "결제 금액")}</dt>
                    <dd>{krw(x.total)}</dd>
                  </div>
                </dl>
                <button className={buttonClass("primary", "sm") + " mt-auto"} disabled={!data.settings.companyConfigured || busy !== null} onClick={() => buy(x.usd)}>
                  {busy === x.usd ? t("Requesting…", "요청 중…") : t("Request purchase", "구매 요청")}
                </button>
              </Card>
            ))}
          </div>
        </>
      )}
      {bank && locked && (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm" data-testid="topup-instructions">
          <p className="font-semibold">
            {t(
              "Transfer the total to the account below. Be sure to put the reference code in the sender name (or memo).",
              "아래 계좌로 결제 금액을 송금해 주세요. 입금자명(또는 메모)에 참조코드를 꼭 적어주세요.",
            )}
          </p>
          <dl className="num mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">{t("Reference code", "참조코드")}</dt>
            <dd className="font-bold text-accent">{locked.referenceCode}</dd>
            <dt className="text-muted">{t("Total to pay (incl. VAT)", "결제 금액 (VAT 포함)")}</dt>
            <dd className="font-bold">{krw(locked.krwTotal)}</dd>
            <dt className="text-muted">{t("Bank", "은행")}</dt>
            <dd>{bank.bankName}</dd>
            <dt className="text-muted">{t("Account", "계좌")}</dt>
            <dd>{bank.bankAccount}</dd>
            <dt className="text-muted">{t("Account holder", "예금주")}</dt>
            <dd>{bank.bankHolder}</dd>
          </dl>
          <p className="mt-2 text-xs text-muted">
            {t(
              <>
                This amount is locked at 1 USD = ₩{locked.fxRate} ({L(locked.fxSource ?? "")}). Once the transfer is confirmed, {usd(locked.requestedE8)} in credits is added.
              </>,
              <>
                환율 1 USD = ₩{locked.fxRate} ({L(locked.fxSource ?? "")})로 고정된 금액입니다. 입금이 확인되면 {usd(locked.requestedE8)} 크레딧이 충전됩니다.
              </>,
            )}
          </p>
        </div>
      )}
      <Card>
        <h3 className="mb-2 font-semibold">{t("Top-up history", "충전 내역")}</h3>
        {data.topups.length === 0 ? (
          <p className="text-sm text-muted">{t("No top-ups yet.", "충전 내역이 없습니다.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <tbody className="num divide-y divide-line">
                {data.topups.map((tp) => (
                  <tr key={tp.id}>
                    <td className="py-1.5">{dateTime(tp.createdAt)}</td>
                    <td>{tp.referenceCode}</td>
                    <td className="text-right">{usd(tp.approvedE8 ?? tp.requestedE8)}</td>
                    <td className="text-right">{krw(tp.krwTotal)}</td>
                    <td className="text-right">
                      <Badge tone={tp.status === "APPROVED" ? "up" : tp.status === "REJECTED" ? "down" : "warn"}>
                        {TOPUP_STATUS[tp.status] ? t(TOPUP_STATUS[tp.status].en, TOPUP_STATUS[tp.status].ko) : tp.status}
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
  const { t, L } = useI18n();
  const [f, setF] = useState({ issuerName: "", customerName: "", description: "", amountUsd: "", jobId: "" });
  const [copied, setCopied] = useState<string | null>(null);
  const link = (token: string) => `${window.location.origin}/invoice/${token}`;
  const linkable = data.jobs.filter((j) => j.status === "COMPLETED" || j.status === "PARTIAL" || j.status === "GENERATING");
  const job = data.jobs.find((j) => j.id === f.jobId);
  const minimum = job ? BigInt(job.priceE8) - BigInt(job.refundedE8) : null;
  return (
    <div className="space-y-6">
      <Notice tone="info">
        {t(
          <>
            Your customer pays into the <b>company account</b> shown on the invoice link. Once the payment is confirmed, the full invoice amount is credited to your payouts and the company transfers it to you. You set the price; an invoice linked to a video job can&apos;t be lower than that job&apos;s price.
          </>,
          <>
            고객은 청구서 링크에 표시된 <b>회사 계좌</b>로 입금합니다. 입금이 확인되면 청구 금액 전액이 정산금으로 적립되고, 회사가 파트너님께 송금합니다. 가격은 파트너님이 정하며, 영상 작업과 연결한 청구서는 그 작업의 이용료보다 낮게 정할 수 없습니다.
          </>,
        )}
      </Notice>
      {!data.settings.companyConfigured && (
        <Notice>{t("The company bank account is not set up yet, so you can't create invoices.", "회사 입금 계좌가 아직 설정되지 않아 청구서를 만들 수 없습니다.")}</Notice>
      )}
      <Card className="space-y-3">
        <h3 className="font-semibold">{t("Create an invoice", "청구서 만들기")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="iissuer">{t("Issuer name (shown to the customer)", "발행자명 (고객에게 표시)")}</label>
            <input id="iissuer" maxLength={80} value={f.issuerName} onChange={(e) => setF({ ...f, issuerName: e.target.value })} />
          </div>
          <div>
            <label htmlFor="icust">{t("Customer name", "고객명")}</label>
            <input id="icust" maxLength={80} value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} />
          </div>
          <div>
            <label htmlFor="ijob">{t("Link a video job (optional)", "연결할 영상 작업 (선택)")}</label>
            <select id="ijob" value={f.jobId} onChange={(e) => setF({ ...f, jobId: e.target.value })}>
              <option value="">{t("Don't link", "연결 안 함")}</option>
              {linkable.map((j) => (
                <option key={j.id} value={j.id}>
                  {t(
                    `${dateTime(j.createdAt)} · ${j.clipCount} videos · price ${usd(BigInt(j.priceE8) - BigInt(j.refundedE8))}`,
                    `${dateTime(j.createdAt)} · ${j.clipCount}개 · 이용료 ${usd(BigInt(j.priceE8) - BigInt(j.refundedE8))}`,
                  )}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="iamt">
              {t("Amount (USD)", "청구 금액 (USD)")}
              {minimum !== null && t(` — minimum ${usd(minimum)}`, ` — 최소 ${usd(minimum)}`)}
            </label>
            <input id="iamt" inputMode="decimal" value={f.amountUsd} onChange={(e) => setF({ ...f, amountUsd: e.target.value })} className="num" />
          </div>
        </div>
        <div>
          <label htmlFor="idesc">{t("Description", "청구 내역")}</label>
          <textarea
            id="idesc"
            rows={2}
            maxLength={1000}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            placeholder={t("e.g. 10 promotional videos", "예: 홍보 영상 10편 제작")}
          />
        </div>
        <button
          className={buttonClass("primary", "sm")}
          disabled={!data.settings.companyConfigured || !f.issuerName || !f.customerName || !f.description || !f.amountUsd}
          onClick={async () => {
            try {
              await apiFetch("/api/partner/invoices", { method: "POST", body: f });
              setF({ ...f, customerName: "", description: "", amountUsd: "", jobId: "" });
              setMsg({
                tone: "info",
                text: t("Invoice created. Copy its link from the list below and send it to your customer.", "청구서를 만들었습니다. 아래 목록에서 링크를 복사해 고객에게 보내세요."),
              });
              onChange();
            } catch (e) {
              setMsg({ tone: "down", text: e instanceof Error ? L(e.message) : t("Failed", "실패") });
            }
          }}
        >
          {t("Issue invoice", "청구서 발행")}
        </button>
      </Card>
      <Card>
        <h3 className="mb-2 font-semibold">{t("Issued invoices", "발행한 청구서")}</h3>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-muted">{t("You haven't issued any invoices.", "발행한 청구서가 없습니다.")}</p>
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
                        {INVOICE_STATUS[i.status] ? t(INVOICE_STATUS[i.status].en, INVOICE_STATUS[i.status].ko) : i.status}
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
                        {copied === i.id ? t("Copied", "복사됨") : t("Copy link", "링크 복사")}
                      </button>
                      {i.status === "ISSUED" && (
                        <button
                          className={buttonClass("ghost", "sm")}
                          onClick={async () => {
                            try {
                              await apiFetch(`/api/partner/invoices/${i.id}/cancel`, { method: "POST", body: {} });
                              onChange();
                            } catch (e) {
                              setMsg({ tone: "down", text: e instanceof Error ? L(e.message) : t("Failed", "실패") });
                            }
                          }}
                        >
                          {t("Cancel", "취소")}
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
  const { t } = useI18n();
  const paid = data.invoices.filter((i) => i.status === "PAID").reduce((s, i) => s + BigInt(i.amountE8), 0n);
  const settled = data.settlements.reduce((s, x) => s + BigInt(x.amountE8), 0n);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={t("Paid invoices total", "입금 확인된 청구 합계")} value={usd(paid)} />
        <Stat label={t("Transferred", "송금 완료")} value={usd(settled)} />
        <Stat
          label={t("Unpaid payouts", "미지급 정산금")}
          value={usd(data.invoicePayableE8)}
          hint={t("Amount the company still owes you", "회사가 파트너님께 송금할 금액")}
        />
      </div>
      <Card>
        <h3 className="mb-2 font-semibold">{t("Transfer history", "송금 내역")}</h3>
        {data.settlements.length === 0 ? (
          <p className="text-sm text-muted">{t("No transfers yet.", "송금 내역이 없습니다.")}</p>
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
