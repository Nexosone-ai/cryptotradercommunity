import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current";
import { getConfig } from "@/lib/config";
import { BotWizard } from "./BotWizard";
import { LoginRequired } from "@/components/LoginRequired";

export const metadata: Metadata = { title: "봇 등록" };
export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: PageProps<"/bots/register">) {
  const user = await getCurrentUser();
  const sp = await searchParams;
  if (!user) return <LoginRequired title="봇 등록은 지갑 서명 로그인이 필요합니다" desc="등록자 지갑 주소는 서명으로 검증된 주소로 자동 입력되며 봇 페이지에 공개됩니다." />;
  const cfg = getConfig();
  return (
    <BotWizard
      ownerAddress={user.walletAddress}
      platformMaxFeeTenthsBp={cfg.platformMaxFeeTenthsBp}
      editId={typeof sp.edit === "string" ? sp.edit : null}
    />
  );
}
