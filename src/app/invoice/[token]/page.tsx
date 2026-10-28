import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, Notice } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { dateTime } from "@/lib/format";
import { getI18n } from "@/lib/i18n-server";
import { formatUsdcE8 } from "@/lib/money";
import { getPublicInvoice, videoSettings } from "@/lib/video/service";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Invoice", "청구서"), robots: { index: false } };
}
export const dynamic = "force-dynamic";

const INVOICE_STATUS: Record<string, { en: string; ko: string }> = {
  ISSUED: { en: "Awaiting payment", ko: "입금 대기" },
  PAID: { en: "Payment received", ko: "입금 확인" },
  CANCELLED: { en: "Cancelled", ko: "취소됨" },
};

/** Public invoice a partner sends to its customer; payment goes to the company account. */
export default async function InvoicePage({ params }: PageProps<"/invoice/[token]">) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const inv = await getPublicInvoice(await getDb(), token);
  if (!inv) notFound();
  const { t } = await getI18n();
  const company = videoSettings().company;
  const status = INVOICE_STATUS[inv.status];

  return (
    <div className="mx-auto max-w-lg space-y-4 py-6">
      <Card className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Invoice</p>
            <h1 className="mt-1 text-xl font-bold">{inv.issuerName}</h1>
          </div>
          <Badge tone={inv.status === "PAID" ? "up" : inv.status === "CANCELLED" ? "neutral" : "warn"}>
            {status ? t(status.en, status.ko) : inv.status}
          </Badge>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">{t("Billed to", "청구 대상")}</dt>
          <dd>{inv.customerName}</dd>
          <dt className="text-muted">{t("Description", "내역")}</dt>
          <dd className="whitespace-pre-wrap">{inv.description}</dd>
          <dt className="text-muted">{t("Issued", "발행일")}</dt>
          <dd className="num">{dateTime(inv.createdAt)}</dd>
          <dt className="text-muted">{t("Amount due", "청구 금액")}</dt>
          <dd className="num text-2xl font-bold text-accent">${formatUsdcE8(inv.amountE8)} USD</dd>
        </dl>

        {inv.status === "ISSUED" && (
          <div className="space-y-2 rounded-lg border border-line-strong bg-panel-2 p-4 text-sm">
            <p className="font-semibold">{t("Pay by bank transfer to", "입금 계좌")}</p>
            <dl className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">{t("Payee", "받는 곳")}</dt>
              <dd>{company.name || "—"}</dd>
              <dt className="text-muted">{t("Bank", "은행")}</dt>
              <dd>{company.bankName || "—"}</dd>
              <dt className="text-muted">{t("Account number", "계좌번호")}</dt>
              <dd>{company.bankAccount || "—"}</dd>
              <dt className="text-muted">{t("Account holder", "예금주")}</dt>
              <dd>{company.bankHolder || "—"}</dd>
              <dt className="text-muted">{t("Sender name / memo", "입금자명/메모")}</dt>
              <dd className="font-bold text-accent">{inv.referenceCode}</dd>
            </dl>
            <p className="text-xs text-muted">
              {t(
                <>Be sure to put the code above in the sender name or memo. Once the transfer is confirmed, the status changes to &lsquo;Payment received&rsquo;.</>,
                <>입금자명 또는 메모에 위 코드를 꼭 적어주세요. 입금 확인 후 상태가 &lsquo;입금 확인&rsquo;으로 바뀝니다.</>,
              )}
            </p>
          </div>
        )}
        {inv.status === "CANCELLED" && (
          <Notice>{t("The issuer cancelled this invoice. Do not pay it.", "발행자가 취소한 청구서입니다. 입금하지 마세요.")}</Notice>
        )}
      </Card>
      <p className="text-center text-xs text-faint">
        {t(
          <>This invoice was issued by {inv.issuerName} through CryptoTraderCommunity. Payment is accepted only into the company account above.</>,
          <>이 청구서는 {inv.issuerName}이(가) CryptoTraderCommunity를 통해 발행했습니다. 대금은 위 회사 계좌로만 받습니다.</>,
        )}
      </p>
    </div>
  );
}
