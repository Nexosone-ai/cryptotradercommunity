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
import { payableBalance } from "@/lib/ledger/service";
import { formatUsdcE8 } from "@/lib/money";
import { HlAccountSummary } from "./HlAccountSummary";

export const metadata: Metadata = { title: "마이페이지" };
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const user = await getCurrentUser();
  if (!user) return <LoginRequired title="마이페이지는 로그인이 필요합니다" />;
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
        <h1 className="text-2xl font-bold">마이페이지</h1>
        <div className="mt-2 text-sm text-muted">
          로그인 지갑 <AddressLink address={user.walletAddress} network={cfg.network} full />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {user.roles.map((r) => (
            <Badge key={r} tone="accent">
              {r}
            </Badge>
          ))}
          {referred && <Badge>추천 코드 {referred.referralCode}로 가입</Badge>}
        </div>
      </div>

      <section>
        <SectionTitle title="Hyperliquid 계정" desc="잔고·포지션은 Hyperliquid가 원본입니다. 플랫폼은 자금을 보관하지 않습니다." action={<LinkButton href="/trade" variant="secondary">트레이딩</LinkButton>} />
        <HlAccountSummary />
      </section>

      <section>
        <SectionTitle title="구독 중인 봇" />
        {subs.length === 0 ? (
          <EmptyState title="구독한 봇이 없습니다" action={<LinkButton href="/bots">봇 마켓</LinkButton>} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {subs.map(({ s, bot }) => (
              <Card key={s.id}>
                <div className="flex items-center justify-between">
                  <Link href={`/bots/${bot.slug}`} className="font-semibold hover:text-accent">
                    {bot.name}
                  </Link>
                  <Badge tone={s.status === "ACTIVE" ? "up" : s.status === "REQUIRES_RECONSENT" ? "warn" : "neutral"}>
                    {{ ACTIVE: "구독 중", REQUIRES_RECONSENT: "재동의 필요", STOPPED: "중지됨" }[s.status] ?? s.status}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted">
                  동의한 수수료 {feeLabel(s.acceptedFeeTenthsBp)} · 동의 {dateTime(s.consentedAt)}
                </p>
                {s.status === "REQUIRES_RECONSENT" && (
                  <p className="mt-1 text-sm text-warn">봇 설정·수수료가 변경되었습니다. 봇 페이지에서 확인 후 재동의하세요.</p>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle title="내가 등록한 봇" action={<LinkButton href="/bots/register">봇 등록</LinkButton>} />
        {myBots.length === 0 ? (
          <EmptyState title="등록한 봇이 없습니다" />
        ) : (
          <>
            <div className="mb-3 grid max-w-md grid-cols-2 gap-3">
              <Stat label="봇 수익 미지급 잔액" value={`${formatUsdcE8(ownerOwed)} USDC`} hint="정산 확정분 기준" />
              <Stat label="정산 방식" value="관리자 승인 지급" hint="자동 지급은 Phase 2" />
            </div>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-panel-2 text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">봇</th>
                    <th className="px-3 py-2">상태</th>
                    <th className="px-3 py-2">수수료</th>
                    <th className="px-3 py-2">버전</th>
                    <th className="px-3 py-2">수정일</th>
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
                      <td className="px-3 py-2">{STATUS_LABELS[b.status]}</td>
                      <td className="num px-3 py-2">{feeLabel(b.feeTenthsBp)}</td>
                      <td className="num px-3 py-2">v{b.configVersion}</td>
                      <td className="num px-3 py-2">{dateTime(b.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section>
        <SectionTitle title="파트너" />
        {partner ? (
          <Notice tone="info">
            파트너 코드 <b>{partner.referralCode}</b> ({partner.eligibilityStatus}) — 대시보드 주소를 직접 입력해 접속하세요: <span className="num">/partner</span>
          </Notice>
        ) : (
          <p className="text-sm text-muted">
            파트너 프로그램에 참여하려면 <Link href="/partners" className="text-accent">파트너 안내</Link>를 확인하세요.
          </p>
        )}
      </section>
    </div>
  );
}
