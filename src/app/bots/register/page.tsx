import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current";
import { getConfig } from "@/lib/config";
import { BotWizard } from "./BotWizard";
import { LoginRequired } from "@/components/LoginRequired";
import { getI18n } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Register a bot", "봇 등록") };
}
export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: PageProps<"/bots/register">) {
  const user = await getCurrentUser();
  const sp = await searchParams;
  const { t } = await getI18n();
  if (!user)
    return (
      <LoginRequired
        title={t("Sign in with your wallet to register a bot", "봇 등록은 지갑 서명 로그인이 필요합니다")}
        desc={t(
          "Your bot owner wallet address is filled in from your signature-verified address and shown on the bot page.",
          "등록자 지갑 주소는 서명으로 검증된 주소로 자동 입력되며 봇 페이지에 공개됩니다.",
        )}
      />
    );
  const cfg = getConfig();
  return (
    <BotWizard
      ownerAddress={user.walletAddress}
      platformMaxFeeTenthsBp={cfg.platformMaxFeeTenthsBp}
      editId={typeof sp.edit === "string" ? sp.edit : null}
      initialStep={sp.step === "source" ? 1 : undefined}
    />
  );
}
