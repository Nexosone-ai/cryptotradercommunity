import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Card, LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { partners, users } from "@/lib/db/schema";
import { maskAddress } from "@/lib/partner/queries";
import { findWholesalerByInvite } from "@/lib/referral/service";
import { JoinButton } from "./JoinButton";

export const metadata: Metadata = { title: "Become an affiliate", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Affiliate invite link of a wholesale partner (/join/{code}). */
export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  const { code } = await params;
  const db = await getDb();
  const wholesaler = await findWholesalerByInvite(db, code);
  const valid = Boolean(wholesaler && wholesaler.eligibilityStatus === "ACTIVE" && wholesaler.wholesalerPortionPpm != null);
  const [owner] = wholesaler ? await db.select({ wallet: users.walletAddress }).from(users).where(eq(users.id, wholesaler.userId)).limit(1) : [];
  const user = await getCurrentUser();
  const [mine] = user ? await db.select().from(partners).where(eq(partners.userId, user.id)).limit(1) : [];

  return (
    <div className="mx-auto max-w-xl space-y-6 py-6">
      <Card className="space-y-4 p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Affiliate invitation</p>
        <h1 className="text-2xl font-bold">Become an affiliate</h1>
        {!valid ? (
          <p className="text-sm text-down">This affiliate invite link is invalid, suspended or not set up yet.</p>
        ) : mine ? (
          <>
            <p className="text-sm text-muted">This wallet is already a partner.</p>
            <LinkButton href="/partner">Open partner dashboard</LinkButton>
          </>
        ) : (
          <>
            <p className="text-sm text-muted" data-testid="join-terms">
              Wholesale partner <b className="num text-text">{owner ? maskAddress(owner.wallet) : ""}</b> invites you to their affiliate program. As an
              affiliate you get your own referral link for clients and earn a share of the Builder Fee on their bot and copy-trading orders. The
              wholesale partner sets the split; you can&apos;t recruit affiliates yourself.
            </p>
            <JoinButton code={code} signedIn={Boolean(user)} />
          </>
        )}
      </Card>
    </div>
  );
}
