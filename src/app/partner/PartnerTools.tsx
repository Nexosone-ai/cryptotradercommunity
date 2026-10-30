"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { buttonClass, Card } from "@/components/ui";
import { apiFetch } from "@/lib/client-api";
import { dateTime } from "@/lib/format";

interface Earning {
  entryId: string;
  tier: number;
  earnedE8: string;
  builderFeeE8: string;
  occurredAt: string;
  bot: string;
  trader: string;
  policyVersion: number;
}

const e8 = (v: string) => (Number(BigInt(v)) / 1e8).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

export function PartnerTools({ code, url }: { code: string; url: string }) {
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState<Earning[] | null>(null);
  const [filter, setFilter] = useState({ tier: "", from: "", to: "" });

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 180, color: { dark: "#000000", light: "#ffffff" } }).then(setQr);
  }, [url]);

  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
  useEffect(() => {
    apiFetch<{ earnings: Earning[] }>(`/api/partner/earnings?${qs}`)
      .then((d) => setRows(d.earnings))
      .catch(() => setRows([]));
  }, [qs]);

  return (
    <div className="space-y-6">
      <Card className="flex flex-col gap-5 sm:flex-row sm:items-center">
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={t("Referral link QR code", "추천 링크 QR 코드")} width={140} height={140} className="rounded-lg" />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-muted">{t("Your referral code", "내 추천 코드")}</p>
          <p className="num text-2xl font-bold tracking-widest text-accent">{code}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="num break-all rounded bg-panel-2 px-2 py-1 text-xs">{url}</code>
            <button
              className={buttonClass("secondary", "sm")}
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? t("Copied", "복사됨") : t("Copy link", "링크 복사")}
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <h2 className="mr-auto font-semibold">{t("Earnings history", "수익 내역")}</h2>
          <div>
            <label>Type</label>
            <select value={filter.tier} onChange={(e) => setFilter({ ...filter, tier: e.target.value })} className="w-auto">
              <option value="">{t("All", "전체")}</option>
              <option value="1">Affiliate</option>
              <option value="2">Wholesale</option>
            </select>
          </div>
          <div>
            <label>{t("From", "시작일")}</label>
            <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} className="w-auto" />
          </div>
          <div>
            <label>{t("To", "종료일")}</label>
            <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} className="w-auto" />
          </div>
          <a href={`/api/partner/earnings?${qs}${qs ? "&" : ""}format=csv`} className={buttonClass("secondary", "sm")}>
            {t("Export CSV", "CSV 내보내기")}
          </a>
        </div>
        {rows === null ? (
          <p className="text-sm text-muted">{t("Loading…", "불러오는 중…")}</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t("No confirmed earnings yet.", "정산 확정된 수익이 아직 없습니다.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1">{t("Filled at", "체결 시각")}</th>
                  <th>Type</th>
                  <th>{t("Bot", "봇")}</th>
                  <th>{t("Trader", "트레이더")}</th>
                  <th className="text-right">Builder Fee</th>
                  <th className="text-right">{t("Your earnings", "내 수익")}</th>
                  <th className="text-right">{t("Policy", "정책")}</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.entryId}>
                    <td className="py-1.5">{dateTime(r.occurredAt)}</td>
                    <td>{r.tier === 1 ? "Affiliate" : "Wholesale"}</td>
                    <td className="font-sans">{r.bot}</td>
                    <td>{r.trader}</td>
                    <td className="text-right">{e8(r.builderFeeE8)}</td>
                    <td className="text-right text-up">{e8(r.earnedE8)}</td>
                    <td className="text-right">v{r.policyVersion}</td>
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
