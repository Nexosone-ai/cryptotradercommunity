import type { Metadata } from "next";
import { Card, SectionTitle } from "@/components/ui";
import { ActivatePartner } from "./ActivatePartner";

export const metadata: Metadata = { title: "파트너 안내" };

const SPLIT = [
  ["봇 등록자", "70%", "수익 전체 × 0.70"],
  ["관리자 배분 풀", "30%", "수익 전체 × 0.30"],
  ["└ 플랫폼 최종 수익", "6%", "풀 30% × 20%"],
  ["└ 1차 추천 파트너", "14.4%", "풀 30% × 80% × 60%"],
  ["└ 2차 추천 파트너", "9.6%", "풀 30% × 80% × 40%"],
];

export default function PartnersPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <SectionTitle
        title="파트너 프로그램"
        desc="추천 링크로 가입한 트레이더가 플랫폼을 통해 실제 체결한 거래에서 발생한 추가 Builder Fee의 일부를 받습니다."
      />

      <Card>
        <h2 className="font-semibold">수익 배분 (정산 확정된 추가 Builder Fee 100% 기준)</h2>
        <table className="mt-3 w-full text-sm">
          <tbody className="divide-y divide-line">
            {SPLIT.map(([who, pct, how]) => (
              <tr key={who}>
                <td className="py-2">{who}</td>
                <td className="num py-2 text-right font-semibold text-accent">{pct}</td>
                <td className="py-2 pl-4 text-right text-xs text-muted">{how}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">예: 정산 확정 Builder Fee 100 USDC → 봇 등록자 70 · 플랫폼 6 · 1차 파트너 14.4 · 2차 파트너 9.6 USDC. 초기 기본값이며 정책 변경은 버전으로 기록되고 과거 정산에는 소급되지 않습니다.</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="font-semibold">1차 · 2차 정의</h3>
          <p className="mt-2 text-sm text-muted">
            A가 B를, B가 C를 추천했다면 C의 거래에서 B는 1차, A는 2차 수익을 받습니다. A가 직접 추천한 D의 거래에서는 A가 1차입니다. 2단계를 넘어서는 지급하지 않습니다.
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold">추천인이 없거나 자격이 없으면</h3>
          <p className="mt-2 text-sm text-muted">
            해당 몫은 존재하지 않는 파트너에게 가상 지급하지 않고 &lsquo;미배정 파트너 예비금&rsquo;으로 별도 보류됩니다. 플랫폼 순이익에 합산하지 않습니다.
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold">관계 고정과 부정 방지</h3>
          <p className="mt-2 text-sm text-muted">
            추천 관계는 최초 지갑 가입 시 등록되고 이후 변경할 수 없습니다. 자기 추천, 순환 추천은 자동 차단되며 다중 계정 부정은 관리자 심사로 제재됩니다.
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold">정산 시점</h3>
          <p className="mt-2 text-sm text-muted">
            Hyperliquid에서 Builder 수익이 확인된 체결만 원장에 확정됩니다. 지급은 관리자 승인 후 진행되며, 자동 지급은 검증 완료 후 도입됩니다.
          </p>
        </Card>
      </div>

      <p className="text-xs text-faint">
        이 프로그램은 플랫폼 내부 2단계 파트너 원장이며 Hyperliquid 자체 referral 프로그램과 별개입니다. 관할 지역의 추천 보상·광고 관련 법규를 준수할 책임은 파트너에게 있습니다.
      </p>

      <ActivatePartner />
    </div>
  );
}
