import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { getI18n } from "@/lib/i18n-server";
import { findPartnerByCode } from "@/lib/referral/service";
import { CaptureReferral } from "./CaptureReferral";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Invitation", "초대") };
}
export const dynamic = "force-dynamic";

export default async function RefPage({ params }: PageProps<"/ref/[code]">) {
  const { code } = await params;
  const { t } = await getI18n();
  const partner = await findPartnerByCode(await getDb(), code);
  const valid = Boolean(partner && partner.eligibilityStatus === "ACTIVE");
  const user = await getCurrentUser();

  return (
    <div className="mx-auto max-w-xl space-y-6 py-6">
      <Card className="space-y-4 p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Invitation</p>
        <h1 className="text-2xl font-bold">{t("You're invited to CryptoTraderCommunity", "CryptoTraderCommunity에 초대되었습니다")}</h1>
        {valid ? (
          <>
            <p className="text-sm text-muted">
              {t(
                <>
                  Referral code <b className="num text-text">{partner!.referralCode}</b> will be saved. The referral is registered the first
                  time you sign in with your wallet (accepting the terms of use) and can&apos;t be changed afterwards.
                </>,
                <>
                  추천 코드 <b className="num text-text">{partner!.referralCode}</b>가 저장됩니다. 처음 지갑으로 로그인(약관 동의)할 때 추천 관계가 등록되며,
                  등록 후에는 변경할 수 없습니다.
                </>,
              )}
            </p>
            {user ? (
              <p className="text-sm text-warn">
                {t(
                  "You're signed in with a wallet that's already registered, so no new referral will be recorded.",
                  "이미 가입된 지갑으로 로그인되어 있어 추천 관계가 새로 등록되지 않습니다.",
                )}
              </p>
            ) : (
              <CaptureReferral code={partner!.referralCode} />
            )}
          </>
        ) : (
          <p className="text-sm text-down">{t("This referral code is invalid or has been suspended.", "유효하지 않거나 사용이 중지된 추천 코드입니다.")}</p>
        )}
        <p className="text-xs text-faint">
          {t(
            "This referral program is the platform's own partner ledger and is separate from Hyperliquid's own referral codes. Referral rewards are paid only from the platform's share of the Builder Fee.",
            "이 추천 프로그램은 플랫폼 자체 파트너 원장이며 Hyperliquid 자체 referral 코드와 별개입니다. 추천 보상은 플랫폼 Builder Fee 몫에서만 지급됩니다.",
          )}
        </p>
      </Card>
    </div>
  );
}
