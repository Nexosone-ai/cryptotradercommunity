import { desc, eq, or } from "drizzle-orm";
import { readContext } from "@/lib/api";
import { referralRelations, users } from "@/lib/db/schema";
import { handler, json } from "@/lib/http";
import { maskAddress } from "@/lib/partner/queries";

/** Referred accounts, masked. Tier 2 shows only aggregate-safe fields. */
export const GET = handler(async () => {
  const { db, user } = await readContext({ role: "PARTNER" });
  const rows = await db
    .select({ rel: referralRelations, wallet: users.walletAddress })
    .from(referralRelations)
    .innerJoin(users, eq(users.id, referralRelations.traderUserId))
    .where(or(eq(referralRelations.directPartnerUserId, user.id), eq(referralRelations.indirectPartnerUserId, user.id)))
    .orderBy(desc(referralRelations.frozenAt))
    .limit(500);
  return json({
    referrals: rows.map((r) => ({
      tier: r.rel.directPartnerUserId === user.id ? 1 : 2,
      trader: maskAddress(r.wallet),
      joinedAt: r.rel.frozenAt,
    })),
  });
});
