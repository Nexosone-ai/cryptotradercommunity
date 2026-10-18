"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonClass, Card, cx, Notice } from "@/components/ui";
import {
  EXECUTION_LABELS,
  EXECUTION_MODES,
  ORDER_TYPES,
  STRATEGY_LABELS,
  STRATEGY_TYPES,
  TIMEFRAMES,
  type BotConfigInput,
} from "@/lib/bots/schema";
import { apiFetch, ClientApiError } from "@/lib/client-api";
import { checksum, feeLabel } from "@/lib/format";

type Form = Omit<BotConfigInput, "consents" | "risk"> & {
  risk: Omit<BotConfigInput["risk"], "emergencyStop"> & { emergencyStop: boolean };
  consents: { terms: boolean; risk: boolean; performancePolicy: boolean };
};

const EMPTY: Form = {
  name: "",
  slug: "",
  logoUrl: "",
  summary: "",
  description: "",
  strategyType: "TREND_FOLLOWING",
  markets: ["BTC-PERP"],
  direction: "BOTH",
  leverageMin: 1,
  leverageMax: 3,
  timeframe: "1h",
  orderTypes: ["MARKET"],
  risk: { maxOrderUsd: 200, maxPositionUsd: 1000, maxLeverage: 3, stopLossPct: 5, dailyLossLimitUsd: 100, emergencyStop: true },
  executionMode: "PLATFORM_TEMPLATE",
  developer: { bio: "", blogUrl: "", xUrl: "", telegramUrl: "" },
  feeTenthsBp: 10,
  consents: { terms: false, risk: false, performancePolicy: false },
};

const STEPS = ["기본 정보", "전략 · 마켓", "위험 한도", "실행 · 개발자", "수수료 · 동의"];

export function BotWizard({ ownerAddress, platformMaxFeeTenthsBp, editId }: { ownerAddress: string; platformMaxFeeTenthsBp: number; editId: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(EMPTY);
  const [markets, setMarkets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: (string | number)[]; message: string }[]>([]);
  const [saved, setSaved] = useState<{ id: string; slug: string; status: string } | null>(null);

  useEffect(() => {
    apiFetch<{ markets: { name: string }[] }>("/api/market/metadata")
      .then((d) => setMarkets(d.markets.map((m) => `${m.name}-PERP`)))
      .catch(() => setMarkets([]));
  }, []);

  useEffect(() => {
    if (!editId) return;
    apiFetch<{ bot: { id: string; slug: string; status: string; config: Form } }>(`/api/bots/${editId}`)
      .then((d) => {
        setF({ ...EMPTY, ...d.bot.config, consents: { terms: false, risk: false, performancePolicy: false } });
        setSaved({ id: d.bot.id, slug: d.bot.slug, status: d.bot.status });
      })
      .catch((e) => setError(e.message));
  }, [editId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const setRisk = (k: keyof Form["risk"], v: number | boolean) => setF((p) => ({ ...p, risk: { ...p.risk, [k]: v } }));
  const issueFor = (prefix: string) => issues.filter((i) => i.path.join(".").startsWith(prefix)).map((i) => i.message);

  async function save(submit: boolean) {
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const payload = { ...f };
      const res = saved
        ? await apiFetch<{ bot: { id: string; slug: string; status: string } }>(`/api/bots/${saved.id}`, { method: "PATCH", body: payload })
        : await apiFetch<{ bot: { id: string; slug: string; status: string } }>("/api/bots", { method: "POST", body: payload });
      let bot = res.bot;
      if (submit && (bot.status === "DRAFT" || bot.status === "REJECTED")) {
        bot = (await apiFetch<{ bot: typeof bot }>(`/api/bots/${bot.id}/submit`, { method: "POST", body: {} })).bot;
      }
      setSaved(bot);
      router.push(`/bots/${bot.slug}`);
    } catch (e) {
      if (e instanceof ClientApiError && Array.isArray(e.details)) setIssues(e.details as typeof issues);
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  const err = (p: string) => {
    const msgs = issueFor(p);
    return msgs.length ? <p className="mt-1 text-xs text-down">{msgs.join(" · ")}</p> : null;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{editId ? "봇 수정" : "봇 등록"}</h1>
        <p className="mt-2 text-sm text-muted">
          등록자 지갑: <span className="num text-text">{checksum(ownerAddress)}</span> (서명 검증된 주소로 자동 입력되며 변경할 수 없습니다)
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className={cx("rounded-full border px-3 py-1", i === step ? "border-accent text-accent" : "border-line text-muted")}
            >
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      <Card className="space-y-4">
        {step === 0 && (
          <>
            <Field label="봇 이름">
              <input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={60} />
              {err("name")}
            </Field>
            <Field label="고유 slug (URL, 생성 후 변경 불가)">
              <input
                value={f.slug}
                disabled={Boolean(saved)}
                onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                placeholder="my-trend-bot"
              />
              {err("slug")}
            </Field>
            <Field label="로고 이미지 URL (https, 선택)">
              <input value={f.logoUrl ?? ""} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…" />
              {err("logoUrl")}
            </Field>
            <Field label="한 줄 소개 (10–140자)">
              <input value={f.summary} onChange={(e) => set("summary", e.target.value)} maxLength={140} />
              {err("summary")}
            </Field>
            <Field label="자세한 전략 설명 (30자 이상)">
              <textarea rows={8} value={f.description} onChange={(e) => set("description", e.target.value)} />
              {err("description")}
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <Field label="전략 유형">
              <select value={f.strategyType} onChange={(e) => set("strategyType", e.target.value as Form["strategyType"])}>
                {STRATEGY_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {STRATEGY_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="거래 마켓 (Hyperliquid Perpetuals, 최대 10개)">
              <input
                value={f.markets.join(", ")}
                onChange={(e) =>
                  set(
                    "markets",
                    e.target.value
                      .toUpperCase()
                      .split(/[,\s]+/)
                      .filter(Boolean),
                  )
                }
                list="perp-markets"
                placeholder="BTC-PERP, ETH-PERP"
              />
              <datalist id="perp-markets">
                {markets.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {markets.length > 0 && f.markets.some((m) => !markets.includes(m)) && (
                <p className="mt-1 text-xs text-warn">Hyperliquid에 없는 마켓: {f.markets.filter((m) => !markets.includes(m)).join(", ")}</p>
              )}
              {err("markets")}
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="방향">
                <select value={f.direction} onChange={(e) => set("direction", e.target.value as Form["direction"])}>
                  <option value="BOTH">롱/숏</option>
                  <option value="LONG">롱만</option>
                  <option value="SHORT">숏만</option>
                </select>
              </Field>
              <Field label="최소 레버리지">
                <input type="number" min={1} max={50} value={f.leverageMin} onChange={(e) => set("leverageMin", Number(e.target.value))} />
              </Field>
              <Field label="최대 레버리지">
                <input type="number" min={1} max={50} value={f.leverageMax} onChange={(e) => set("leverageMax", Number(e.target.value))} />
                {err("leverageMax")}
              </Field>
            </div>
            <Field label="타임프레임">
              <select value={f.timeframe} onChange={(e) => set("timeframe", e.target.value as Form["timeframe"])}>
                {TIMEFRAMES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="주문 유형">
              <div className="flex flex-wrap gap-4">
                {ORDER_TYPES.map((o) => (
                  <label key={o} className="flex items-center gap-2 text-text">
                    <input
                      type="checkbox"
                      checked={f.orderTypes.includes(o)}
                      onChange={(e) =>
                        set("orderTypes", e.target.checked ? [...f.orderTypes, o] : f.orderTypes.filter((x) => x !== o))
                      }
                    />
                    {o}
                  </label>
                ))}
              </div>
              {err("orderTypes")}
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="1회 최대 주문 (USDC)">
                <input type="number" min={1} value={f.risk.maxOrderUsd} onChange={(e) => setRisk("maxOrderUsd", Number(e.target.value))} />
                {err("risk.maxOrderUsd")}
              </Field>
              <Field label="최대 포지션 규모 (USDC)">
                <input type="number" min={1} value={f.risk.maxPositionUsd} onChange={(e) => setRisk("maxPositionUsd", Number(e.target.value))} />
              </Field>
              <Field label="최대 레버리지">
                <input type="number" min={1} max={50} value={f.risk.maxLeverage} onChange={(e) => setRisk("maxLeverage", Number(e.target.value))} />
                {err("risk.maxLeverage")}
              </Field>
              <Field label="손절 (%) — 필수">
                <input type="number" min={0.1} step={0.1} value={f.risk.stopLossPct} onChange={(e) => setRisk("stopLossPct", Number(e.target.value))} />
              </Field>
              <Field label="일일 손실 한도 (USDC)">
                <input type="number" min={1} value={f.risk.dailyLossLimitUsd} onChange={(e) => setRisk("dailyLossLimitUsd", Number(e.target.value))} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-text">
              <input type="checkbox" checked={f.risk.emergencyStop} onChange={(e) => setRisk("emergencyStop", e.target.checked)} />
              긴급 중단(kill switch) 지원 — 필수
            </label>
            {err("risk")}
            {f.risk.maxLeverage > 25 && <Notice>최대 레버리지 25배 초과: 강제청산 위험이 매우 높아 심사에서 제한될 수 있습니다.</Notice>}
          </>
        )}

        {step === 3 && (
          <>
            <Field label="실행 방식">
              <select value={f.executionMode} onChange={(e) => set("executionMode", e.target.value as Form["executionMode"])}>
                {EXECUTION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {EXECUTION_LABELS[m]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-faint">
                업로드한 임의 코드는 프로덕션 서버에서 실행하지 않습니다. 패키지·Webhook은 샌드박스 격리와 보안 심사 후 Phase 2에서 활성화됩니다.
              </p>
            </Field>
            <Field label="개발자 소개">
              <textarea rows={3} value={f.developer.bio} onChange={(e) => set("developer", { ...f.developer, bio: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              {(["blogUrl", "xUrl", "telegramUrl"] as const).map((k) => (
                <Field key={k} label={{ blogUrl: "블로그", xUrl: "X", telegramUrl: "Telegram" }[k] + " (https, 선택)"}>
                  <input value={f.developer[k] ?? ""} onChange={(e) => set("developer", { ...f.developer, [k]: e.target.value })} />
                  {err(`developer.${k}`)}
                </Field>
              ))}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <Field label={`추가 Builder Fee율 — 플랫폼 상한 ${feeLabel(platformMaxFeeTenthsBp)} (Hyperliquid 상한 0.1%)`}>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={platformMaxFeeTenthsBp}
                  value={f.feeTenthsBp}
                  onChange={(e) => set("feeTenthsBp", Number(e.target.value))}
                  className="flex-1 border-0 bg-transparent p-0"
                />
                <span className="num w-20 text-right text-accent">{feeLabel(f.feeTenthsBp)}</span>
              </div>
              <p className="mt-1 text-xs text-faint">
                체결 금액 10,000 USDC당 {(f.feeTenthsBp / 10).toFixed(1)} USDC. 정산 확정분의 70%가 등록자 몫입니다. 인상 시 기존 구독자는 재동의 전까지 이전 수수료가 유지됩니다.
              </p>
              {err("feeTenthsBp")}
            </Field>
            {(
              [
                ["terms", "이용약관에 동의합니다."],
                ["risk", "위험 고지(손실·청산·시스템 장애)를 이해했습니다."],
                ["performancePolicy", "수익률 표시 정책(실거래 검증 전 수치 미표시, 백테스트 분리)에 동의합니다."],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-text">
                <input type="checkbox" checked={f.consents[k]} onChange={(e) => set("consents", { ...f.consents, [k]: e.target.checked })} />
                {l}
              </label>
            ))}
            {err("consents")}
          </>
        )}
      </Card>

      {error && <Notice tone="down">{error}</Notice>}
      {issues.length > 0 && (
        <Notice tone="down">
          <ul className="list-inside list-disc">
            {issues.map((i, n) => (
              <li key={n}>
                {i.path.join(".")}: {i.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="flex flex-wrap justify-between gap-3">
        <button className={buttonClass("secondary")} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          이전
        </button>
        {step < STEPS.length - 1 ? (
          <button className={buttonClass("primary")} onClick={() => setStep((s) => s + 1)}>
            다음
          </button>
        ) : (
          <div className="flex gap-2">
            <button className={buttonClass("secondary")} disabled={busy} onClick={() => save(false)}>
              {saved ? "변경 저장" : "초안 저장"}
            </button>
            <button className={buttonClass("primary")} disabled={busy} onClick={() => save(true)}>
              저장 후 심사 요청
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}
