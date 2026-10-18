import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { userRoles, users } from "@/lib/db/schema";
import type { Role, SessionUser } from "@/lib/auth/session";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

export async function testDb(): Promise<Db> {
  return createDb({ dataDir: "memory" });
}

export interface TestUser extends SessionUser {
  account: ReturnType<typeof privateKeyToAccount>;
}

/** Inserts a user with roles and returns a SessionUser-shaped object. */
export async function makeUser(db: Db, roles: Role[] = ["TRADER"]): Promise<TestUser> {
  const account = privateKeyToAccount(generatePrivateKey());
  const [u] = await db
    .insert(users)
    .values({ walletAddress: account.address.toLowerCase(), termsAcceptedAt: new Date() })
    .returning();
  for (const role of roles) await db.insert(userRoles).values({ userId: u.id, role });
  return { id: u.id, walletAddress: u.walletAddress as `0x${string}`, roles, sessionId: "test", chainId: 1, account };
}

export async function rolesOf(db: Db, userId: string) {
  return (await db.select().from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.role);
}

export function validBotInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Alpha Trend",
    slug: `alpha-trend-${Math.random().toString(36).slice(2, 8)}`,
    summary: "BTC 4시간봉 추세 추종 전략입니다.",
    description: "이동평균 교차와 ATR 기반 손절을 사용하는 추세 추종 전략입니다. 레버리지는 낮게 유지합니다.",
    strategyType: "TREND_FOLLOWING",
    markets: ["BTC-PERP", "ETH-PERP"],
    direction: "BOTH",
    leverageMin: 1,
    leverageMax: 5,
    timeframe: "4h",
    orderTypes: ["MARKET", "LIMIT"],
    risk: {
      maxOrderUsd: 500,
      maxPositionUsd: 2000,
      maxLeverage: 5,
      stopLossPct: 5,
      dailyLossLimitUsd: 200,
      emergencyStop: true,
    },
    executionMode: "PLATFORM_TEMPLATE",
    developer: { bio: "quant dev" },
    feeTenthsBp: 20,
    consents: { terms: true, risk: true, performancePolicy: true },
    ...overrides,
  };
}
