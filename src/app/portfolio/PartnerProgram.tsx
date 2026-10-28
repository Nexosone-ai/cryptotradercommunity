import { Card } from "@/components/ui";
import { getI18n } from "@/lib/i18n-server";

const SPLIT = [
  { key: "owner", who: ["Bot owner", "봇 등록자"], pct: "70%", how: ["Total revenue × 0.70", "수익 전체 × 0.70"] },
  { key: "pool", who: ["Admin allocation pool", "관리자 배분 풀"], pct: "30%", how: ["Total revenue × 0.30", "수익 전체 × 0.30"] },
  { key: "platform", who: ["└ Platform net revenue", "└ 플랫폼 최종 수익"], pct: "6%", how: ["Pool 30% × 20%", "풀 30% × 20%"] },
  { key: "tier1", who: ["└ Tier-1 referral partner", "└ 1차 추천 파트너"], pct: "14.4%", how: ["Pool 30% × 80% × 60%", "풀 30% × 80% × 60%"] },
  { key: "tier2", who: ["└ Tier-2 referral partner", "└ 2차 추천 파트너"], pct: "9.6%", how: ["Pool 30% × 80% × 40%", "풀 30% × 80% × 40%"] },
] as const;

/** How partner earnings work. Shown only in the Partner section of My page (signed-in users). */
export async function PartnerProgram() {
  const { t } = await getI18n();
  return (
    <div className="space-y-4">

      <Card>
        <h2 className="font-semibold">{t("Revenue split (as a share of 100% of confirmed additional Builder Fee)", "수익 배분 (정산 확정된 추가 Builder Fee 100% 기준)")}</h2>
        <table className="mt-3 w-full text-sm">
          <tbody className="divide-y divide-line">
            {SPLIT.map(({ key, who, pct, how }) => (
              <tr key={key}>
                <td className="py-2">{t(who[0], who[1])}</td>
                <td className="num py-2 text-right font-semibold text-accent">{pct}</td>
                <td className="py-2 pl-4 text-right text-xs text-muted">{t(how[0], how[1])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          {t(
            "Example: 100 USDC of confirmed Builder Fee → bot owner 70 · platform 6 · tier-1 partner 14.4 · tier-2 partner 9.6 USDC. These are the initial defaults; policy changes are recorded as versions and never apply retroactively to past settlements.",
            "예: 정산 확정 Builder Fee 100 USDC → 봇 등록자 70 · 플랫폼 6 · 1차 파트너 14.4 · 2차 파트너 9.6 USDC. 초기 기본값이며 정책 변경은 버전으로 기록되고 과거 정산에는 소급되지 않습니다.",
          )}
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="font-semibold">{t("Tier-1 and tier-2", "1차 · 2차 정의")}</h3>
          <p className="mt-2 text-sm text-muted">
            {t(
              "If A referred B and B referred C, then on C's trades B earns tier-1 and A earns tier-2. On trades by D, whom A referred directly, A is tier-1. Nothing is paid beyond two levels.",
              "A가 B를, B가 C를 추천했다면 C의 거래에서 B는 1차, A는 2차 수익을 받습니다. A가 직접 추천한 D의 거래에서는 A가 1차입니다. 2단계를 넘어서는 지급하지 않습니다.",
            )}
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold">{t("No referrer, or referrer not eligible", "추천인이 없거나 자격이 없으면")}</h3>
          <p className="mt-2 text-sm text-muted">
            {t(
              <>That share is not paid out to a non-existent partner; it is held separately as the &lsquo;unassigned partner reserve&rsquo; and is not added to platform net income.</>,
              <>해당 몫은 존재하지 않는 파트너에게 가상 지급하지 않고 &lsquo;미배정 파트너 예비금&rsquo;으로 별도 보류됩니다. 플랫폼 순이익에 합산하지 않습니다.</>,
            )}
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold">{t("Locked relationships and fraud prevention", "관계 고정과 부정 방지")}</h3>
          <p className="mt-2 text-sm text-muted">
            {t(
              "A referral relationship is recorded when the wallet first signs up and cannot be changed afterwards. Self-referrals and circular referrals are blocked automatically, and multi-account abuse is sanctioned after admin review.",
              "추천 관계는 최초 지갑 가입 시 등록되고 이후 변경할 수 없습니다. 자기 추천, 순환 추천은 자동 차단되며 다중 계정 부정은 관리자 심사로 제재됩니다.",
            )}
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold">{t("When earnings settle", "정산 시점")}</h3>
          <p className="mt-2 text-sm text-muted">
            {t(
              "Only fills whose Builder revenue is confirmed on Hyperliquid are recorded in the ledger. Payouts go out after admin approval; automatic payouts will be introduced once verified.",
              "Hyperliquid에서 Builder 수익이 확인된 체결만 원장에 확정됩니다. 지급은 관리자 승인 후 진행되며, 자동 지급은 검증 완료 후 도입됩니다.",
            )}
          </p>
        </Card>
      </div>

      <p className="text-xs text-faint">
        {t(
          "This program is the platform's internal two-level partner ledger and is separate from Hyperliquid's own referral program. Partners are responsible for complying with referral-reward and advertising laws in their jurisdiction.",
          "이 프로그램은 플랫폼 내부 2단계 파트너 원장이며 Hyperliquid 자체 referral 프로그램과 별개입니다. 관할 지역의 추천 보상·광고 관련 법규를 준수할 책임은 파트너에게 있습니다.",
        )}
      </p>
    </div>
  );
}
