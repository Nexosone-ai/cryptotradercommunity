import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, SectionTitle, Stat } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { getI18n } from "@/lib/i18n-server";
import { formatUsdcE8 } from "@/lib/money";
import { partnerSummary } from "@/lib/partner/queries";
import { PartnerServices } from "./PartnerServices";
import { PartnerTools } from "./PartnerTools";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Partner dashboard", "파트너 대시보드"), robots: { index: false } };
}
export const dynamic = "force-dynamic";

/** Not linked from the menu; access is enforced here and in every /api/partner route. */
export default async function PartnerDashboard() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("PARTNER")) notFound();
  const db = await getDb();
  const s = await partnerSummary(db, user.id);
  if (!s) notFound();
  const { t } = await getI18n();
  const url = new URL(`/ref/${s.partner.referralCode}`, getConfig().appUrl).toString();
  const active = s.partner.eligibilityStatus === "ACTIVE";

  return (
    <div className="space-y-6">
      <SectionTitle
        title={t("Partner dashboard", "파트너 대시보드")}
        desc={t(`Status: ${active ? "Active" : "Payouts on hold"}`, `상태: ${active ? "활성" : "지급 보류"}`)}
      />
      <PartnerTools code={s.partner.referralCode} url={url} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Tier-1 referrals (direct)", "1차 추천 (직접)")} value={t(`${s.counts.direct}`, `${s.counts.direct}명`)} />
        <Stat label={t("Tier-2 referrals (indirect)", "2차 추천 (간접)")} value={t(`${s.counts.indirect}`, `${s.counts.indirect}명`)} />
        <Stat label={t("Tier-1 earnings (confirmed)", "1차 수익 (확정)")} value={`${formatUsdcE8(s.tier1EarnedE8)} USDC`} />
        <Stat label={t("Tier-2 earnings (confirmed)", "2차 수익 (확정)")} value={`${formatUsdcE8(s.tier2EarnedE8)} USDC`} />
        <Stat label={t("Unpaid balance", "미지급 잔액")} value={`${formatUsdcE8(s.unpaidE8)} USDC`} />
        <Stat label={t("Paid out", "지급 완료")} value={`${formatUsdcE8(s.paidE8)} USDC`} />
        <Stat
          label={t("Referred trades' Builder Fee (confirmed)", "추천 거래 Builder Fee (확정)")}
          value={`${formatUsdcE8(s.referredFeesConfirmedE8)} USDC`}
        />
        <Stat
          label={t("Referred trades' Builder Fee (pending)", "추천 거래 Builder Fee (확인 대기)")}
          value={`${formatUsdcE8(s.referredFeesObservedE8)} USDC`}
          hint={t("Not yet settled; not included in earnings", "정산 확정 전, 수익에 미포함")}
        />
      </div>
      <PartnerServices />
      <Card className="text-xs leading-relaxed text-muted">
        {t(
          <>
            How it&apos;s calculated: confirmed additional Builder Fee × admin pool 30% × partner pool 80% × (tier-1 60% / tier-2 40%). Each earnings row shows the fee policy version in effect when the trade filled.
            Referred traders&apos; wallets are masked for privacy, and no positions or other individual trade details are shared.
          </>,
          <>
            계산 근거: 정산 확정된 추가 Builder Fee × 관리자 풀 30% × 파트너 풀 80% × (1차 60% / 2차 40%). 각 수익 행에는 체결 시점의 수수료 정책 버전이 표시됩니다.
            추천 트레이더 지갑은 개인정보 보호를 위해 마스킹되며 포지션 등 개별 거래 정보는 제공하지 않습니다.
          </>,
        )}
      </Card>
    </div>
  );
}
