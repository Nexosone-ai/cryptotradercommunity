import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, SectionTitle, Stat } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { formatUsdcE8 } from "@/lib/money";
import { partnerSummary } from "@/lib/partner/queries";
import { PartnerServices } from "./PartnerServices";
import { PartnerTools } from "./PartnerTools";

export const metadata: Metadata = { title: "파트너 대시보드", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Not linked from the menu; access is enforced here and in every /api/partner route. */
export default async function PartnerDashboard() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("PARTNER")) notFound();
  const db = await getDb();
  const s = await partnerSummary(db, user.id);
  if (!s) notFound();
  const url = new URL(`/ref/${s.partner.referralCode}`, getConfig().appUrl).toString();

  return (
    <div className="space-y-6">
      <SectionTitle title="파트너 대시보드" desc={`상태: ${s.partner.eligibilityStatus === "ACTIVE" ? "활성" : "지급 보류"}`} />
      <PartnerTools code={s.partner.referralCode} url={url} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="1차 추천 (직접)" value={`${s.counts.direct}명`} />
        <Stat label="2차 추천 (간접)" value={`${s.counts.indirect}명`} />
        <Stat label="1차 수익 (확정)" value={`${formatUsdcE8(s.tier1EarnedE8)} USDC`} />
        <Stat label="2차 수익 (확정)" value={`${formatUsdcE8(s.tier2EarnedE8)} USDC`} />
        <Stat label="미지급 잔액" value={`${formatUsdcE8(s.unpaidE8)} USDC`} />
        <Stat label="지급 완료" value={`${formatUsdcE8(s.paidE8)} USDC`} />
        <Stat label="추천 거래 Builder Fee (확정)" value={`${formatUsdcE8(s.referredFeesConfirmedE8)} USDC`} />
        <Stat label="추천 거래 Builder Fee (확인 대기)" value={`${formatUsdcE8(s.referredFeesObservedE8)} USDC`} hint="정산 확정 전, 수익에 미포함" />
      </div>
      <PartnerServices />
      <Card className="text-xs leading-relaxed text-muted">
        계산 근거: 정산 확정된 추가 Builder Fee × 관리자 풀 30% × 파트너 풀 80% × (1차 60% / 2차 40%). 각 수익 행에는 체결 시점의 수수료 정책 버전이 표시됩니다.
        추천 트레이더 지갑은 개인정보 보호를 위해 마스킹되며 포지션 등 개별 거래 정보는 제공하지 않습니다.
      </Card>
    </div>
  );
}
