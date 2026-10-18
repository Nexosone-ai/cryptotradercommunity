import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/current";
import { getPublicConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { partners, referralRelations } from "@/lib/db/schema";
import { handler, json } from "@/lib/http";

export const GET = handler(async () => {
  const user = await getCurrentUser();
  const config = getPublicConfig();
  if (!user) return json({ user: null, config });
  const db = await getDb();
  const [partner] = await db.select().from(partners).where(eq(partners.userId, user.id)).limit(1);
  const [referred] = await db.select().from(referralRelations).where(eq(referralRelations.traderUserId, user.id)).limit(1);
  return json({
    user: { id: user.id, walletAddress: user.walletAddress, roles: user.roles },
    partner: partner ? { referralCode: partner.referralCode, eligibilityStatus: partner.eligibilityStatus } : null,
    referredBy: referred ? { code: referred.referralCode, since: referred.frozenAt } : null,
    config,
  });
});
