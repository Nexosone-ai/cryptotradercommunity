import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { AddressLink } from "@/components/AddressLink";
import { LoginRequired } from "@/components/LoginRequired";
import { Badge, Card, EmptyState, LinkButton, Notice, SectionTitle, Stat } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current";
import { listBotsByOwner } from "@/lib/bots/service";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { bots, botSubscriptions, partners, referralRelations } from "@/lib/db/schema";
import { dateTime, feeLabel, STATUS_LABELS } from "@/lib/format";
import { getI18n } from "@/lib/i18n-server";
import { payableBalance } from "@/lib/ledger/service";
import { formatUsdcE8 } from "@/lib/money";
import { HlAccountSummary } from "./HlAccountSummary";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("My page", "마이페이지") };
}
export const dynamic = "force-dynamic";

const SUB_STATUS: Record<string, { en: string; ko: string }> = {
  ACTIVE: { en: "Subscribed", ko: "구독 중" },
  REQUIRES_RECONSENT: { en: "Re-consent required", ko: "재동의 필요" },
  STOPPED: { en: "Stopped", ko: "중지됨" },
};

export default async function PortfolioPage() {
  const { t, L } = await getI18n();
  const user = await getCurrentUser();
  if (!user) return <LoginRequired title={t("Sign in to see My page", "마이페이지는 로그인이 필요합니다")} />;
  const db = await getDb();
  const cfg = getConfig();
  const [myBots, subs, [partner], [referred], ownerOwed] = await Promise.all([
    listBotsByOwner(db, user.id),
    db
      .select({ s: botSubscriptions, bot: bots })
      .from(botSubscriptions)
      .innerJoin(bots, eq(bots.id, botSubscriptions.botId))
      .where(and(eq(botSubscriptions.userId, user.id), eq(botSubscriptions.network, cfg.network)))
      .orderBy(desc(botSubscriptions.consentedAt)),
    db.select().from(partners).where(eq(partners.userId, user.id)).limit(1),
    db.select().from(referralRelations).where(eq(referralRelations.traderUserId, user.id)).limit(1),
    payableBalance(db, user.id, "BOT_OWNER_PAYABLE"),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("My page", "마이페이지")}</h1>
        <div className="mt-2 text-sm text-muted">
          {t("Signed-in wallet", "로그인 지갑")} <AddressLink address={user.walletAddress} network={cfg.network} full />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {user.roles.map((r) => (
            <Badge key={r} tone="accent">
              {r}
            </Badge>
          ))}
          {referred && (
            <Badge>
              {t(<>Joined with referral code {referred.referralCode}</>, <>추천 코드 {referred.referralCode}로 가입</>)}
            </Badge>
          )}
        </div>
      </div>

      <section>
        <SectionTitle
          title={t("Hyperliquid account", "Hyperliquid 계정")}
          desc={t(
            "Hyperliquid is the source of truth for balances and positions. The platform never holds your funds.",
            "잔고·포지션은 Hyperliquid가 원본입니다. 플랫폼은 자금을 보관하지 않습니다.",
          )}
          action={
            <LinkButton href="/trade" variant="secondary">
              {t("Trade", "트레이딩")}
            </LinkButton>
          }
        />
        <HlAccountSummary />
      </section>

      <section>
        <SectionTitle title={t("Subscribed bots", "구독 중인 봇")} />
        {subs.length === 0 ? (
          <EmptyState
            title={t("You haven't subscribed to any bots", "구독한 봇이 없습니다")}
            action={<LinkButton href="/bots">{t("Bot market", "봇 마켓")}</LinkButton>}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {subs.map(({ s, bot }) => (
              <Card key={s.id}>
                <div className="flex items-center justify-between">
                  <Link href={`/bots/${bot.slug}`} className="font-semibold hover:text-accent">
                    {bot.name}
                  </Link>
                  <Badge tone={s.status === "ACTIVE" ? "up" : s.status === "REQUIRES_RECONSENT" ? "warn" : "neutral"}>
                    {SUB_STATUS[s.status] ? t(SUB_STATUS[s.status].en, SUB_STATUS[s.status].ko) : s.status}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {t(
                    <>
                      Accepted fee {L(feeLabel(s.acceptedFeeTenthsBp))} · consented {L(dateTime(s.consentedAt))}
                    </>,
                    <>
                      동의한 수수료 {L(feeLabel(s.acceptedFeeTenthsBp))} · 동의 {L(dateTime(s.consentedAt))}
                    </>,
                  )}
                </p>
                {s.status === "REQUIRES_RECONSENT" && (
                  <p className="mt-1 text-sm text-warn">
                    {t(
                      "The bot's settings or fee have changed. Review them on the bot page and re-consent.",
                      "봇 설정·수수료가 변경되었습니다. 봇 페이지에서 확인 후 재동의하세요.",
                    )}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle
          title={t("Bots you registered", "내가 등록한 봇")}
          action={<LinkButton href="/bots/register">{t("Register bot", "봇 등록")}</LinkButton>}
        />
        {myBots.length === 0 ? (
          <EmptyState title={t("You haven't registered any bots", "등록한 봇이 없습니다")} />
        ) : (
          <>
            <div className="mb-3 grid max-w-md grid-cols-2 gap-3">
              <Stat
                label={t("Unpaid bot revenue balance", "봇 수익 미지급 잔액")}
                value={`${formatUsdcE8(ownerOwed)} USDC`}
                hint={t("Confirmed (settled) amounts only", "정산 확정분 기준")}
              />
              <Stat
                label={t("Payout method", "정산 방식")}
                value={t("Paid on admin approval", "관리자 승인 지급")}
                hint={t("Automatic payouts in Phase 2", "자동 지급은 Phase 2")}
              />
            </div>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-panel-2 text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">{t("Bot", "봇")}</th>
                    <th className="px-3 py-2">{t("Status", "상태")}</th>
                    <th className="px-3 py-2">{t("Fee", "수수료")}</th>
                    <th className="px-3 py-2">{t("Version", "버전")}</th>
                    <th className="px-3 py-2">{t("Updated", "수정일")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {myBots.map((b) => (
                    <tr key={b.id}>
                      <td className="px-3 py-2">
                        <Link href={`/bots/${b.slug}`} className="hover:text-accent">
                          {b.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{L(STATUS_LABELS[b.status] ?? "")}</td>
                      <td className="num px-3 py-2">{L(feeLabel(b.feeTenthsBp))}</td>
                      <td className="num px-3 py-2">v{b.configVersion}</td>
                      <td className="num px-3 py-2">{L(dateTime(b.updatedAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section>
        <SectionTitle title={t("Partner", "파트너")} />
        {partner ? (
          <Notice tone="info">
            {t(
              <>
                Partner code <b>{partner.referralCode}</b> ({partner.eligibilityStatus}) — open the dashboard by typing its address directly:{" "}
                <span className="num">/partner</span>
              </>,
              <>
                파트너 코드 <b>{partner.referralCode}</b> ({partner.eligibilityStatus}) — 대시보드 주소를 직접 입력해 접속하세요: <span className="num">/partner</span>
              </>,
            )}
          </Notice>
        ) : (
          <p className="text-sm text-muted">
            {t(
              <>
                To join the partner program, see{" "}
                <Link href="/partners" className="text-accent">
                  Partners
                </Link>
                .
              </>,
              <>
                파트너 프로그램에 참여하려면 <Link href="/partners" className="text-accent">파트너 안내</Link>를 확인하세요.
              </>,
            )}
          </p>
        )}
      </section>
    </div>
  );
}
