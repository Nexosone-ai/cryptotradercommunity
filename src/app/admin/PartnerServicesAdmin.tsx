"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Badge, buttonClass, Card, Notice, Stat } from "@/components/ui";
import { apiFetch } from "@/lib/client-api";
import { dateTime, shortAddress } from "@/lib/format";
import { formatUsdcE8 } from "@/lib/money";

const usd = (e8: string | bigint | null | undefined) => (e8 === null || e8 === undefined ? "—" : `$${formatUsdcE8(BigInt(e8))}`);

interface Data {
  topups: { t: { id: string; requestedE8: string; approvedE8: string | null; referenceCode: string; status: string; createdAt: string; krwTotal: string | null; fxRate: string | null }; wallet: string }[];
  invoices: { i: { id: string; customerName: string; issuerName: string; amountE8: string; referenceCode: string; status: string; createdAt: string }; wallet: string }[];
  jobs: { count: number; costE8: string; priceE8: string; refundedE8: string };
  payables: { userId: string; wallet: string; owed: string }[];
  settings: { falConfigured: boolean; markupPpm: number; company: { name: string; bankAccount: string } };
}

/** Bank top-ups, customer invoice payments and partner settlements (all manual, all audited). */
export function PartnerServicesAdmin() {
  const { t, L } = useI18n();
  const [d, setD] = useState<Data | null>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [settle, setSettle] = useState<Record<string, { amount: string; ref: string }>>({});
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    apiFetch<Data>("/api/admin/partner-services")
      .then(setD)
      .catch((e) => setMsg({ tone: "down", text: e.message }));
  }, [tick]);

  const run = async (url: string, body: unknown, ok: string) => {
    try {
      await apiFetch(url, { method: "POST", body });
      setMsg({ tone: "info", text: ok });
      reload();
    } catch (e) {
      setMsg({ tone: "down", text: e instanceof Error ? L(e.message) : t("Failed", "실패") });
    }
  };

  if (!d) return <p className="text-sm text-muted">{t("Loading…", "불러오는 중…")}</p>;
  const net = BigInt(d.jobs.priceE8) - BigInt(d.jobs.refundedE8);
  const pendingTopups = d.topups.filter((x) => x.t.status === "PENDING");
  const issued = d.invoices.filter((x) => x.i.status === "ISSUED");

  return (
    <div className="space-y-6">
      {msg && <Notice tone={msg.tone}>{L(msg.text)}</Notice>}
      {!d.settings.falConfigured && (
        <Notice>{t("FAL_KEY is not set, so video generation is disabled.", "FAL_KEY가 설정되지 않아 영상 생성이 비활성화되어 있습니다.")}</Notice>
      )}
      {!d.settings.company.bankAccount && (
        <Notice>
          {t(
            "COMPANY_NAME / COMPANY_BANK_* are not set, so top-up requests and invoicing are disabled.",
            "COMPANY_NAME / COMPANY_BANK_* 가 설정되지 않아 충전 요청과 청구서 발행이 비활성화되어 있습니다.",
          )}
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Video jobs", "영상 작업")} value={d.jobs.count} />
        <Stat label={t("fal cost (list-price estimate)", "fal 원가 (정가 추정)")} value={usd(d.jobs.costE8)} />
        <Stat
          label={t("Partner charges (net of refunds)", "파트너 이용료 (환불 차감)")}
          value={usd(net)}
          hint={t(`Markup ×${(d.settings.markupPpm / 1_000_000).toFixed(2)}`, `마크업 ×${(d.settings.markupPpm / 1_000_000).toFixed(2)}`)}
        />
        <Stat label={t("Refunds", "환불")} value={usd(d.jobs.refundedE8)} />
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">{t(`Confirm top-up transfers (${pendingTopups.length})`, `충전 입금 확인 (${pendingTopups.length})`)}</h2>
        {pendingTopups.length === 0 ? (
          <p className="text-sm text-muted">{t("No pending top-up requests.", "대기 중인 충전 요청이 없습니다.")}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {pendingTopups.map(({ t: tp, wallet }) => (
                <tr key={tp.id}>
                  <td className="num py-2">{dateTime(tp.createdAt)}</td>
                  <td className="num">{shortAddress(wallet)}</td>
                  <td className="num font-bold">{tp.referenceCode}</td>
                  <td className="num text-right">
                    {t(`${usd(tp.requestedE8)} credits`, `${usd(tp.requestedE8)} 크레딧`)}
                    {tp.krwTotal && (
                      <span className="block text-xs font-bold text-accent">
                        {t(
                          `Expected ₩${BigInt(tp.krwTotal).toLocaleString("ko-KR")} (incl. VAT, rate ${tp.fxRate})`,
                          `입금 예정 ₩${BigInt(tp.krwTotal).toLocaleString("ko-KR")} (VAT 포함, 환율 ${tp.fxRate})`,
                        )}
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    <span className="inline-flex gap-1">
                      <input
                        placeholder={t("Adjusted credit USD (optional)", "크레딧 조정 USD (선택)")}
                        value={received[tp.id] ?? ""}
                        onChange={(e) => setReceived({ ...received, [tp.id]: e.target.value })}
                        className="num w-28"
                      />
                      <button
                        className={buttonClass("primary", "sm")}
                        onClick={() =>
                          run(
                            `/api/admin/partner-services/topups/${tp.id}`,
                            { decision: "APPROVE", receivedUsd: received[tp.id] || undefined },
                            t("Top-up approved", "충전을 승인했습니다"),
                          )
                        }
                      >
                        {t("Confirm transfer", "입금 확인")}
                      </button>
                      <button
                        className={buttonClass("danger", "sm")}
                        onClick={() => {
                          const note = window.prompt(t("Reason for rejection", "거절 사유"));
                          if (note) void run(`/api/admin/partner-services/topups/${tp.id}`, { decision: "REJECT", note }, t("Rejected", "거절했습니다"));
                        }}
                      >
                        {t("Reject", "거절")}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">{t(`Confirm customer invoice payments (${issued.length})`, `고객 청구서 입금 확인 (${issued.length})`)}</h2>
        {d.invoices.length === 0 ? (
          <p className="text-sm text-muted">{t("No invoices.", "청구서가 없습니다.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <tbody className="divide-y divide-line">
                {d.invoices.map(({ i, wallet }) => (
                  <tr key={i.id}>
                    <td className="num py-2">{dateTime(i.createdAt)}</td>
                    <td>
                      {i.issuerName} <span className="num text-xs text-muted">({shortAddress(wallet)})</span>
                    </td>
                    <td>{i.customerName}</td>
                    <td className="num font-bold">{i.referenceCode}</td>
                    <td className="num text-right">{usd(i.amountE8)}</td>
                    <td className="text-right">
                      {i.status === "ISSUED" ? (
                        <button
                          className={buttonClass("primary", "sm")}
                          onClick={() =>
                            run(
                              `/api/admin/partner-services/invoices/${i.id}/paid`,
                              {},
                              t("Payment confirmed — credited to the partner's payouts", "입금 확인 — 파트너 정산금으로 적립했습니다"),
                            )
                          }
                        >
                          {t("Confirm payment", "입금 확인")}
                        </button>
                      ) : (
                        <Badge tone={i.status === "PAID" ? "up" : "neutral"}>{i.status}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">{t("Partner payout transfers", "파트너 정산금 송금")}</h2>
        {d.payables.length === 0 ? (
          <p className="text-sm text-muted">{t("No unpaid payouts.", "미지급 정산금이 없습니다.")}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {d.payables.map((p) => {
                const s = settle[p.userId] ?? { amount: formatUsdcE8(BigInt(p.owed)), ref: "" };
                return (
                  <tr key={p.userId}>
                    <td className="num py-2">{shortAddress(p.wallet)}</td>
                    <td className="num">{t(`Unpaid ${usd(p.owed)}`, `미지급 ${usd(p.owed)}`)}</td>
                    <td className="text-right">
                      <span className="inline-flex gap-1">
                        <input value={s.amount} onChange={(e) => setSettle({ ...settle, [p.userId]: { ...s, amount: e.target.value } })} className="num w-28" />
                        <input
                          placeholder={t("Transfer record (bank, date/time)", "이체 기록 (은행·일시)")}
                          value={s.ref}
                          onChange={(e) => setSettle({ ...settle, [p.userId]: { ...s, ref: e.target.value } })}
                          className="w-48"
                        />
                        <button
                          className={buttonClass("primary", "sm")}
                          disabled={!s.ref}
                          onClick={() =>
                            run(
                              "/api/admin/partner-services/settlements",
                              { partnerUserId: p.userId, amountUsd: s.amount, bankReference: s.ref },
                              t("Transfer recorded", "송금을 기록했습니다"),
                            )
                          }
                        >
                          {t("Record transfer", "송금 기록")}
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted">
          {t(
            "Make the transfer from the company account first, then record it here. Records go to the ledger and the audit log.",
            "송금은 회사 계좌에서 직접 이체한 뒤 여기에 기록합니다. 기록은 원장과 감사 로그에 남습니다.",
          )}
        </p>
      </Card>
    </div>
  );
}
