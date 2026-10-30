import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, LinkButton, SectionTitle, Stat } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getI18n } from "@/lib/i18n-server";
import { getPolicyAt } from "@/lib/ledger/service";
import { formatUsdcE8 } from "@/lib/money";
import { maskAddress, partnerSummary } from "@/lib/partner/queries";
import { ensureInviteCode, listAffiliates, partnerPoolPpm } from "@/lib/referral/service";
import { AffiliateProgram } from "./AffiliateProgram";
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
  const cfg = getConfig();
  const url = new URL(`/ref/${s.partner.referralCode}`, cfg.appUrl).toString();
  const active = s.partner.eligibilityStatus === "ACTIVE";
  const wholesale = s.partner.kind === "WHOLESALE";
  const policy = await getPolicyAt(db, new Date());
  const poolPpm = partnerPoolPpm(policy);
  const pct = (ppm: number) => `${Number((ppm / 10_000).toFixed(2))}%`;

  const inviteCode = wholesale && s.partner.wholesalerPortionPpm != null ? await ensureInviteCode(db, user.id) : null;
  const affiliates = wholesale ? await listAffiliates(db, user.id) : [];
  const [upline] =
    !wholesale && s.partner.wholesalerUserId
      ? await db.select({ wallet: users.walletAddress }).from(users).where(eq(users.id, s.partner.wholesalerUserId)).limit(1)
      : [];

  return (
    <div className="space-y-6">
      <SectionTitle
        title={wholesale ? "Wholesale partner dashboard" : "Affiliate dashboard"}
        desc={`Status: ${active ? "Active" : "Payouts on hold"}${upline ? ` · Affiliate of ${maskAddress(upline.wallet)}` : ""}`}
        action={
          <LinkButton href="/portfolio#partner" variant="secondary">
            {t("← My page", "← 마이페이지")}
          </LinkButton>
        }
      />
      <PartnerTools code={s.partner.referralCode} url={url} />
      {wholesale && (
        <AffiliateProgram
          portionPpm={s.partner.wholesalerPortionPpm}
          ownerPpm={policy.botOwnerSharePpm}
          poolPpm={poolPpm}
          inviteUrl={inviteCode ? new URL(`/join/${inviteCode}`, cfg.appUrl).toString() : null}
          affiliates={affiliates.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))}
        />
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Clients you referred" value={`${s.counts.direct}`} />
        {wholesale ? <Stat label="Clients of your affiliates" value={`${s.counts.indirect}`} /> : <Stat label="Your affiliate share" value="Set by your wholesale partner" />}
        <Stat label="Affiliate earnings (confirmed)" value={`${formatUsdcE8(s.tier1EarnedE8)} USDC`} hint="From clients you referred as an affiliate" />
        <Stat label="Wholesale earnings (confirmed)" value={`${formatUsdcE8(s.tier2EarnedE8)} USDC`} hint="Your own clients and your affiliates' clients" />
        <Stat label={t("Unpaid balance", "미지급 잔액")} value={`${formatUsdcE8(s.unpaidE8)} USDC`} />
        <Stat label={t("Paid out", "지급 완료")} value={`${formatUsdcE8(s.paidE8)} USDC`} />
        <Stat label="Referred trades' Builder Fee (confirmed)" value={`${formatUsdcE8(s.referredFeesConfirmedE8)} USDC`} />
        <Stat
          label="Referred trades' Builder Fee (pending)"
          value={`${formatUsdcE8(s.referredFeesObservedE8)} USDC`}
          hint="Not yet settled; not included in earnings"
        />
      </div>
      <Card className="text-xs leading-relaxed text-muted">
        How it&apos;s calculated: of each confirmed additional Builder Fee, {pct(policy.botOwnerSharePpm)} goes to the bot or copy-trading operator,{" "}
        {pct(1_000_000 - policy.botOwnerSharePpm - poolPpm)} to the platform and {pct(poolPpm)} to partners. A wholesale partner&apos;s own clients give them
        the whole {pct(poolPpm)}; for an affiliate&apos;s client the wholesale partner keeps their portion and the affiliate gets the rest. Clients with no
        partner leave the partner share to the platform. Each earnings row shows the fee policy version in effect when the trade filled. Referred
        traders&apos; wallets are masked for privacy, and no positions or other individual trade details are shared.
      </Card>
    </div>
  );
}
