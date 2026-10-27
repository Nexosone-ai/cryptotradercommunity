import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { writeAudit } from "../audit";
import type { SessionUser } from "../auth/session";
import { grantRole } from "../auth/service";
import { getConfig } from "../config";
import type { Db } from "../db/client";
import { botReviewLogs, botSources, botSubscriptions, bots, botVersions } from "../db/schema";
import { badRequest, conflict, forbidden, notFound } from "../http";
import { assessBotRisk } from "./risk";
import { botConfigSchema, type BotConfig, type StoredBotConfig } from "./schema";
import { normalizeSource, pineMeta, type SourceInput } from "./source";

export type BotStatus = (typeof bots.$inferSelect)["status"];
export type BotRow = typeof bots.$inferSelect;

/** Statuses in which a bot is visible in the public market. */
export const PUBLIC_STATUSES: BotStatus[] = ["LIVE", "PAUSED"];

/** Allowed state machine transitions (docs/PRD.md §bot lifecycle). */
const TRANSITIONS: Record<BotStatus, BotStatus[]> = {
  DRAFT: ["SUBMITTED", "ARCHIVED"],
  SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["LIVE", "SUBMITTED", "SUSPENDED", "ARCHIVED"],
  LIVE: ["PAUSED", "SUBMITTED", "SUSPENDED"],
  PAUSED: ["LIVE", "SUBMITTED", "SUSPENDED", "ARCHIVED"],
  REJECTED: ["SUBMITTED", "ARCHIVED"],
  SUSPENDED: ["PAUSED", "ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: BotStatus, to: BotStatus) {
  return TRANSITIONS[from].includes(to);
}

function assertTransition(from: BotStatus, to: BotStatus) {
  if (!canTransition(from, to)) throw conflict("INVALID_STATUS_TRANSITION", `${from} → ${to} 상태 변경은 허용되지 않습니다.`);
}

/** Key-order independent JSON (jsonb does not preserve key order). */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** Separates the source code from the config; the config keeps only metadata + hash. */
export function splitSource(config: BotConfig): { stored: StoredBotConfig; source: { code: string; language: string; sha256: string } | null } {
  const { source, ...rest } = config;
  if (!source) return { stored: rest, source: null };
  const code = normalizeSource(source.code);
  const sha256 = createHash("sha256").update(code).digest("hex");
  return {
    stored: {
      ...rest,
      source: {
        language: source.language,
        visibility: source.visibility,
        sha256,
        bytes: Buffer.byteLength(code),
        lines: code.split("\n").length - 1,
        pine: source.language === "PINESCRIPT" ? pineMeta(code) : null,
      },
    },
    source: { code, language: source.language, sha256 },
  };
}

async function saveSource(tx: Pick<Db, "insert">, botId: string, userId: string, source: { code: string; language: string; sha256: string } | null) {
  if (!source) return;
  await tx
    .insert(botSources)
    .values({ botId, sha256: source.sha256, language: source.language, code: source.code, bytes: Buffer.byteLength(source.code), createdBy: userId })
    .onConflictDoNothing();
}

export function hashConfig(config: BotConfig | StoredBotConfig): string {
  return createHash("sha256").update(canonicalJson(config)).digest("hex");
}

/** Fields whose change after approval requires a new review. */
function materialPart(c: StoredBotConfig) {
  return {
    sourceSha256: c.source?.sha256 ?? null,
    strategyType: c.strategyType,
    markets: c.markets,
    direction: c.direction,
    leverageMin: c.leverageMin,
    leverageMax: c.leverageMax,
    timeframe: c.timeframe,
    orderTypes: c.orderTypes,
    risk: c.risk,
    executionMode: c.executionMode,
  };
}

async function loadOwnedBot(db: Db, user: SessionUser, botId: string) {
  const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
  if (!bot) throw notFound("봇을 찾을 수 없습니다.");
  if (bot.ownerUserId !== user.id) throw forbidden("본인이 등록한 봇만 변경할 수 있습니다.");
  return bot;
}

export async function createBot(db: Db, user: SessionUser, input: unknown) {
  const parsed = botConfigSchema.parse(input);
  const { stored: config, source } = splitSource(parsed);
  const cfg = getConfig();
  if (config.feeTenthsBp > cfg.platformMaxFeeTenthsBp) {
    throw badRequest("FEE_ABOVE_PLATFORM_CAP", "추가 Builder Fee가 플랫폼 상한을 초과합니다.");
  }
  const risk = assessBotRisk(parsed, cfg.platformMaxFeeTenthsBp);
  const [taken] = await db.select({ id: bots.id }).from(bots).where(eq(bots.slug, config.slug)).limit(1);
  if (taken) throw conflict("SLUG_TAKEN", "이미 사용 중인 slug입니다.");

  return db.transaction(async (tx) => {
    const [bot] = await tx
      .insert(bots)
      .values({
        ownerUserId: user.id,
        ownerWalletAddress: user.walletAddress, // from the verified session, never from input
        name: config.name,
        slug: config.slug,
        summary: config.summary,
        strategyType: config.strategyType,
        feeTenthsBp: config.feeTenthsBp,
        config,
        riskLevel: risk.level,
      })
      .returning();
    await saveSource(tx, bot.id, user.id, source);
    await tx.insert(botVersions).values({
      botId: bot.id,
      version: 1,
      configHash: hashConfig(config),
      config,
      feeTenthsBp: config.feeTenthsBp,
      changedBy: user.id,
      changeNote: "created",
    });
    await grantRole(tx as unknown as Db, user.id, "BOT_OWNER", "self:bot-created");
    return { bot, risk };
  });
}

/**
 * Updates a bot. Material changes to an approved bot send it back to review.
 * Fee increases never reach existing subscribers without re-consent; fee
 * decreases apply to them immediately.
 */
export async function updateBot(db: Db, user: SessionUser, botId: string, input: unknown) {
  const bot = await loadOwnedBot(db, user, botId);
  if (["SUBMITTED", "UNDER_REVIEW", "SUSPENDED", "ARCHIVED"].includes(bot.status)) {
    throw conflict("BOT_LOCKED", "심사 중이거나 중단/보관된 봇은 수정할 수 없습니다.");
  }
  const parsedNext = botConfigSchema.parse(input);
  const { stored: next, source } = splitSource(parsedNext);
  const prev = bot.config as StoredBotConfig;
  if (next.slug !== bot.slug) throw badRequest("SLUG_IMMUTABLE", "slug는 생성 후 변경할 수 없습니다.");
  const cfg = getConfig();
  if (next.feeTenthsBp > cfg.platformMaxFeeTenthsBp) {
    throw badRequest("FEE_ABOVE_PLATFORM_CAP", "추가 Builder Fee가 플랫폼 상한을 초과합니다.");
  }
  if (hashConfig(next) === hashConfig(prev)) return { bot, changed: false };

  const risk = assessBotRisk(parsedNext, cfg.platformMaxFeeTenthsBp);
  const approvedLike = ["APPROVED", "LIVE", "PAUSED"].includes(bot.status);
  const material = canonicalJson(materialPart(next)) !== canonicalJson(materialPart(prev));
  const nextStatus: BotStatus = approvedLike && material ? "SUBMITTED" : bot.status;
  if (nextStatus !== bot.status) {
    assertTransition(bot.status, nextStatus);
    const findings = risk.findings.filter((f) => f.severity === "BLOCK");
    if (findings.length) throw badRequest("RISK_BLOCKED", "위험 검사를 통과하지 못했습니다.", findings);
  }
  const version = bot.configVersion + 1;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(bots)
      .set({
        name: next.name,
        summary: next.summary,
        strategyType: next.strategyType,
        feeTenthsBp: next.feeTenthsBp,
        config: next,
        riskLevel: risk.level,
        configVersion: version,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(bots.id, bot.id))
      .returning();
    await saveSource(tx, bot.id, user.id, source);
    await tx.insert(botVersions).values({
      botId: bot.id,
      version,
      configHash: hashConfig(next),
      config: next,
      feeTenthsBp: next.feeTenthsBp,
      changedBy: user.id,
      changeNote: material && approvedLike ? "material change → re-review" : "edit",
    });

    const subs = and(eq(botSubscriptions.botId, bot.id), ne(botSubscriptions.status, "STOPPED"));
    if (next.feeTenthsBp > prev.feeTenthsBp || material) {
      // Requires re-consent; existing subscribers keep their accepted fee until then.
      await tx
        .update(botSubscriptions)
        .set({ status: "REQUIRES_RECONSENT", pendingFeeTenthsBp: next.feeTenthsBp })
        .where(subs);
    } else if (next.feeTenthsBp < prev.feeTenthsBp) {
      await tx
        .update(botSubscriptions)
        .set({ acceptedFeeTenthsBp: next.feeTenthsBp })
        .where(and(subs, eq(botSubscriptions.status, "ACTIVE")));
    }
    return { bot: updated, changed: true, risk, requiresReview: nextStatus === "SUBMITTED" && approvedLike };
  });
}

export async function submitBot(db: Db, user: SessionUser, botId: string) {
  const bot = await loadOwnedBot(db, user, botId);
  assertTransition(bot.status, "SUBMITTED");
  const risk = assessBotRisk(bot.config as BotConfig, getConfig().platformMaxFeeTenthsBp);
  const blocks = risk.findings.filter((f) => f.severity === "BLOCK");
  if (blocks.length) throw badRequest("RISK_BLOCKED", "위험 검사를 통과하지 못했습니다.", blocks);
  const [updated] = await db
    .update(bots)
    .set({ status: "SUBMITTED", riskLevel: risk.level, updatedAt: new Date() })
    .where(eq(bots.id, bot.id))
    .returning();
  return updated;
}

/** Owner go-live / pause / archive. Pausing blocks new bot orders immediately. */
export async function ownerSetStatus(db: Db, user: SessionUser, botId: string, to: "LIVE" | "PAUSED" | "ARCHIVED") {
  const bot = await loadOwnedBot(db, user, botId);
  if (bot.status === "SUSPENDED" && to !== "ARCHIVED") {
    throw forbidden("관리자에 의해 중단된 봇은 관리자 해제 후에만 재개할 수 있습니다.");
  }
  assertTransition(bot.status, to);
  if (to === "LIVE" && bot.status === "PAUSED" && !(await wasApproved(db, bot.id))) {
    throw forbidden("승인 이력이 없는 봇은 공개할 수 없습니다.");
  }
  const [updated] = await db
    .update(bots)
    .set({ status: to, liveSince: to === "LIVE" ? (bot.liveSince ?? new Date()) : bot.liveSince, updatedAt: new Date() })
    .where(eq(bots.id, bot.id))
    .returning();
  return updated;
}

async function wasApproved(db: Db, botId: string) {
  const [log] = await db
    .select({ id: botReviewLogs.id })
    .from(botReviewLogs)
    .where(and(eq(botReviewLogs.botId, botId), eq(botReviewLogs.toStatus, "APPROVED")))
    .limit(1);
  return Boolean(log);
}

export type ReviewDecision = "START_REVIEW" | "APPROVE" | "REJECT" | "SUSPEND";

export async function reviewBot(db: Db, admin: SessionUser, botId: string, decision: ReviewDecision, reason?: string) {
  if (!admin.roles.includes("ADMIN")) throw forbidden();
  const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
  if (!bot) throw notFound("봇을 찾을 수 없습니다.");
  if (bot.ownerUserId === admin.id) throw forbidden("본인이 등록한 봇은 심사할 수 없습니다 (이해충돌).");
  const to: BotStatus = { START_REVIEW: "UNDER_REVIEW", APPROVE: "APPROVED", REJECT: "REJECTED", SUSPEND: "SUSPENDED" }[
    decision
  ] as BotStatus;
  assertTransition(bot.status, to);
  if ((decision === "REJECT" || decision === "SUSPEND") && !reason?.trim()) {
    throw badRequest("REASON_REQUIRED", "반려/중단 사유를 입력해 주세요.");
  }
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(bots)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(bots.id, bot.id), eq(bots.status, bot.status)))
      .returning();
    if (!updated) throw conflict("CONCURRENT_UPDATE", "다른 변경과 충돌했습니다. 새로고침 후 다시 시도해 주세요.");
    await tx.insert(botReviewLogs).values({
      botId: bot.id,
      reviewerUserId: admin.id,
      fromStatus: bot.status,
      toStatus: to,
      reason: reason ?? null,
    });
    await writeAudit(tx, {
      actorUserId: admin.id,
      actorWallet: admin.walletAddress,
      action: `BOT_${decision}`,
      targetType: "bot",
      targetId: bot.id,
      before: { status: bot.status },
      after: { status: to },
      reason,
    });
    return updated;
  });
}

// ── Subscriptions ──────────────────────────────────────────────────────────

export async function subscribe(
  db: Db,
  user: SessionUser,
  botId: string,
  input: { acceptedFeeTenthsBp: number; acceptRisk: boolean },
) {
  if (input.acceptRisk !== true) throw badRequest("RISK_CONSENT_REQUIRED", "위험 고지에 동의해야 합니다.");
  const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
  if (!bot || bot.status !== "LIVE") throw conflict("BOT_NOT_LIVE", "현재 구독할 수 없는 봇입니다.");
  if (bot.ownerUserId === user.id) throw badRequest("SELF_SUBSCRIBE", "본인 봇은 구독할 수 없습니다.");
  if (input.acceptedFeeTenthsBp !== bot.feeTenthsBp) {
    throw conflict("FEE_CHANGED", "봇 수수료율이 변경되었습니다. 최신 수수료를 확인 후 다시 동의해 주세요.");
  }
  const network = getConfig().network;
  const now = new Date();
  const [row] = await db
    .insert(botSubscriptions)
    .values({
      botId,
      userId: user.id,
      network,
      status: "ACTIVE",
      acceptedFeeTenthsBp: bot.feeTenthsBp,
      acceptedConfigVersion: bot.configVersion,
      consentedAt: now,
    })
    .onConflictDoUpdate({
      target: [botSubscriptions.botId, botSubscriptions.userId, botSubscriptions.network],
      set: {
        status: "ACTIVE",
        acceptedFeeTenthsBp: bot.feeTenthsBp,
        acceptedConfigVersion: bot.configVersion,
        pendingFeeTenthsBp: null,
        consentedAt: now,
        stoppedAt: null,
      },
    })
    .returning();
  return row;
}

/** User stop command: takes effect for the next order check (no grace period). */
export async function unsubscribe(db: Db, user: SessionUser, botId: string) {
  const [row] = await db
    .update(botSubscriptions)
    .set({ status: "STOPPED", stoppedAt: new Date() })
    .where(and(eq(botSubscriptions.botId, botId), eq(botSubscriptions.userId, user.id)))
    .returning();
  if (!row) throw notFound("구독 정보가 없습니다.");
  return row;
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function getBotForViewer(db: Db, idOrSlug: string, viewer: SessionUser | null) {
  const [bot] = await db
    .select()
    .from(bots)
    .where(or(eq(bots.id, idOrSlug), eq(bots.slug, idOrSlug.toLowerCase())))
    .limit(1);
  if (!bot) return null;
  const isOwner = viewer?.id === bot.ownerUserId;
  const isAdmin = Boolean(viewer?.roles.includes("ADMIN"));
  if (!PUBLIC_STATUSES.includes(bot.status) && !isOwner && !isAdmin) return null;
  return { bot, isOwner, isAdmin };
}

export async function listBotsByOwner(db: Db, userId: string) {
  return db.select().from(bots).where(eq(bots.ownerUserId, userId)).orderBy(desc(bots.updatedAt));
}

export async function listPendingBots(db: Db) {
  return db
    .select()
    .from(bots)
    .where(inArray(bots.status, ["SUBMITTED", "UNDER_REVIEW"]))
    .orderBy(bots.updatedAt);
}

export async function listBotVersions(db: Db, botId: string) {
  return db.select().from(botVersions).where(eq(botVersions.botId, botId)).orderBy(desc(botVersions.version));
}

/**
 * Source code of the bot's current version for this viewer: PUBLIC sources
 * are visible to everyone; PRIVATE ones only to the owner and admins.
 */
export async function getBotSource(db: Db, bot: BotRow, viewer: SessionUser | null) {
  const meta = (bot.config as StoredBotConfig).source;
  if (!meta) return null;
  const canSee = meta.visibility === "PUBLIC" || viewer?.id === bot.ownerUserId || Boolean(viewer?.roles.includes("ADMIN"));
  if (!canSee) return { meta, code: null };
  const [row] = await db
    .select({ code: botSources.code })
    .from(botSources)
    .where(and(eq(botSources.botId, bot.id), eq(botSources.sha256, meta.sha256)))
    .limit(1);
  return { meta, code: row?.code ?? null };
}

export type { SourceInput };
