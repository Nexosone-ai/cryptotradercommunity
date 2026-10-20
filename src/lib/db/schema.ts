import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/*
 * Money convention: every ledger/fee amount is a bigint in units of 1e-8 USDC
 * ("e8"). Hyperliquid reports builder rewards with up to 8 decimals.
 * Fee rates are integers in tenths of a basis point (Hyperliquid's unit).
 * Share ratios are integers in parts-per-million (1_000_000 = 100%).
 */

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const e8 = (name: string) => bigint(name, { mode: "bigint" });

export const roleEnum = pgEnum("role", ["TRADER", "BOT_OWNER", "PARTNER", "ADMIN"]);
export const networkEnum = pgEnum("hl_network", ["testnet", "mainnet"]);
export const botStatusEnum = pgEnum("bot_status", [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "LIVE",
  "PAUSED",
  "ARCHIVED",
  "REJECTED",
  "SUSPENDED",
]);

// ── Identity & auth ────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: id(),
  /** Lowercase 0x address; display uses the checksum form. */
  walletAddress: text("wallet_address").notNull().unique(),
  status: text("status").notNull().default("ACTIVE"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [check("users_wallet_lower", sql`${t.walletAddress} = lower(${t.walletAddress})`)]);

export const userRoles = pgTable("user_roles", {
  userId: text("user_id").notNull().references(() => users.id),
  role: roleEnum("role").notNull(),
  grantedAt: createdAt(),
  grantedBy: text("granted_by"),
}, (t) => [primaryKey({ columns: [t.userId, t.role] })]);

export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  chainId: integer("chain_id").notNull(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: id(),
  /** sha256 of the cookie token; the token itself is never stored. */
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id),
  walletAddress: text("wallet_address").notNull(),
  chainId: integer("chain_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

// ── Bots ───────────────────────────────────────────────────────────────────

export const bots = pgTable("bots", {
  id: id(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  /** Copied from the owner's verified wallet by the server; never client-supplied. */
  ownerWalletAddress: text("owner_wallet_address").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  summary: text("summary").notNull(),
  status: botStatusEnum("status").notNull().default("DRAFT"),
  strategyType: text("strategy_type").notNull(),
  feeTenthsBp: integer("fee_tenths_bp").notNull(),
  configVersion: integer("config_version").notNull().default(1),
  /** Full validated bot config (strategy, markets, risk, links). */
  config: jsonb("config").notNull(),
  riskLevel: text("risk_level").notNull(),
  liveSince: timestamp("live_since", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("bots_status_idx").on(t.status),
  index("bots_owner_idx").on(t.ownerUserId),
  check("bots_fee_range", sql`${t.feeTenthsBp} >= 0 and ${t.feeTenthsBp} <= 100`),
]);

export const botVersions = pgTable("bot_versions", {
  id: id(),
  botId: text("bot_id").notNull().references(() => bots.id),
  version: integer("version").notNull(),
  configHash: text("config_hash").notNull(),
  config: jsonb("config").notNull(),
  feeTenthsBp: integer("fee_tenths_bp").notNull(),
  changedBy: text("changed_by").notNull().references(() => users.id),
  changeNote: text("change_note"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("bot_versions_bot_version_uq").on(t.botId, t.version)]);

export const botReviewLogs = pgTable("bot_review_logs", {
  id: id(),
  botId: text("bot_id").notNull().references(() => bots.id),
  reviewerUserId: text("reviewer_user_id").notNull().references(() => users.id),
  fromStatus: botStatusEnum("from_status").notNull(),
  toStatus: botStatusEnum("to_status").notNull(),
  reason: text("reason"),
  createdAt: createdAt(),
});

export const botSubscriptions = pgTable("bot_subscriptions", {
  id: id(),
  botId: text("bot_id").notNull().references(() => bots.id),
  userId: text("user_id").notNull().references(() => users.id),
  network: networkEnum("network").notNull(),
  /** ACTIVE | REQUIRES_RECONSENT | STOPPED */
  status: text("status").notNull(),
  /** Fee the subscriber agreed to. Orders use this, never the bot's current fee. */
  acceptedFeeTenthsBp: integer("accepted_fee_tenths_bp").notNull(),
  acceptedConfigVersion: integer("accepted_config_version").notNull(),
  pendingFeeTenthsBp: integer("pending_fee_tenths_bp"),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("bot_subscriptions_bot_user_net_uq").on(t.botId, t.userId, t.network)]);

// ── Trading ────────────────────────────────────────────────────────────────

export const tradingAccounts = pgTable("trading_accounts", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id),
  network: networkEnum("network").notNull(),
  /** The user's own Hyperliquid master account (same as the login wallet in Phase 1). */
  hlAddress: text("hl_address").notNull(),
  lastFillSyncAt: timestamp("last_fill_sync_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("trading_accounts_user_net_uq").on(t.userId, t.network)]);

export const agentAuthorizations = pgTable("agent_authorizations", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id),
  network: networkEnum("network").notNull(),
  agentAddress: text("agent_address").notNull().unique(),
  agentName: text("agent_name").notNull(),
  /** AES-256-GCM ciphertext (iv.tag.data, base64). Plaintext keys are never stored. */
  encryptedKey: text("encrypted_key").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  /** PENDING | ACTIVE | REVOKED | EXPIRED */
  status: text("status").notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("agent_auth_user_idx").on(t.userId, t.network)]);

export const builderFeeApprovals = pgTable("builder_fee_approvals", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id),
  network: networkEnum("network").notNull(),
  builderAddress: text("builder_address").notNull(),
  /** As reported by Hyperliquid info `maxBuilderFee`, tenths of a bp. */
  maxFeeTenthsBp: integer("max_fee_tenths_bp").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("builder_fee_approvals_uq").on(t.userId, t.network, t.builderAddress)]);

export const orders = pgTable("orders", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id),
  botId: text("bot_id").references(() => bots.id),
  subscriptionId: text("subscription_id").references(() => botSubscriptions.id),
  /** MANUAL | BOT */
  source: text("source").notNull(),
  network: networkEnum("network").notNull(),
  hlAddress: text("hl_address").notNull(),
  cloid: text("cloid").notNull().unique(),
  hlOrderId: bigint("hl_order_id", { mode: "number" }),
  coin: text("coin").notNull(),
  side: text("side").notNull(),
  orderType: text("order_type").notNull(),
  price: text("price").notNull(),
  size: text("size").notNull(),
  reduceOnly: boolean("reduce_only").notNull().default(false),
  builderFeeTenthsBp: integer("builder_fee_tenths_bp").notNull(),
  /** PENDING | RESTING | FILLED | CANCELED | REJECTED | ERROR */
  status: text("status").notNull(),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("orders_user_idx").on(t.userId), index("orders_bot_idx").on(t.botId)]);

export const fills = pgTable("fills", {
  id: id(),
  network: networkEnum("network").notNull(),
  hlAddress: text("hl_address").notNull(),
  tid: bigint("tid", { mode: "number" }).notNull(),
  hlOrderId: bigint("hl_order_id", { mode: "number" }).notNull(),
  orderId: text("order_id").references(() => orders.id),
  botId: text("bot_id").references(() => bots.id),
  userId: text("user_id").references(() => users.id),
  coin: text("coin").notNull(),
  side: text("side").notNull(),
  price: text("price").notNull(),
  size: text("size").notNull(),
  closedPnl: text("closed_pnl").notNull(),
  fee: text("fee").notNull(),
  builderFee: text("builder_fee"),
  feeToken: text("fee_token").notNull(),
  hash: text("hash").notNull(),
  crossed: boolean("crossed").notNull(),
  sourceTime: timestamp("source_time", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("fills_network_tid_oid_uq").on(t.network, t.tid, t.hlOrderId),
  index("fills_bot_idx").on(t.botId),
]);

export const positionsSnapshots = pgTable("positions_snapshots", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id),
  botId: text("bot_id").references(() => bots.id),
  network: networkEnum("network").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  takenAt: createdAt(),
});

export const botPerformanceSnapshots = pgTable("bot_performance_snapshots", {
  id: id(),
  botId: text("bot_id").notNull().references(() => bots.id),
  period: text("period").notNull(),
  verification: text("verification").notNull(),
  metrics: jsonb("metrics").notNull(),
  methodology: text("methodology").notNull(),
  computedAt: createdAt(),
}, (t) => [index("bot_perf_bot_idx").on(t.botId, t.period)]);

// ── Partners & referrals ───────────────────────────────────────────────────

export const partners = pgTable("partners", {
  id: id(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  referralCode: text("referral_code").notNull().unique(),
  /** ACTIVE | SUSPENDED */
  eligibilityStatus: text("eligibility_status").notNull(),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const referralRelations = pgTable("referral_relations", {
  traderUserId: text("trader_user_id").primaryKey().references(() => users.id),
  directPartnerUserId: text("direct_partner_user_id").notNull().references(() => users.id),
  indirectPartnerUserId: text("indirect_partner_user_id").references(() => users.id),
  referralCode: text("referral_code").notNull(),
  frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("referral_direct_idx").on(t.directPartnerUserId),
  index("referral_indirect_idx").on(t.indirectPartnerUserId),
  check("referral_no_self", sql`${t.traderUserId} <> ${t.directPartnerUserId}`),
]);

// ── Fees, ledger, payouts ─────────────────────────────────────────────────

export const feePolicyVersions = pgTable("fee_policy_versions", {
  id: id(),
  version: integer("version").notNull().unique(),
  botOwnerSharePpm: integer("bot_owner_share_ppm").notNull(),
  platformShareOfPoolPpm: integer("platform_share_of_pool_ppm").notNull(),
  tier1ShareOfPartnerPoolPpm: integer("tier1_share_of_partner_pool_ppm").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  /** ACTIVE | SUPERSEDED */
  status: text("status").notNull(),
  approvedBy: text("approved_by").references(() => users.id),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [
  check("fee_policy_ranges", sql`${t.botOwnerSharePpm} between 0 and 1000000
    and ${t.platformShareOfPoolPpm} between 0 and 1000000
    and ${t.tier1ShareOfPartnerPoolPpm} between 0 and 1000000`),
]);

export const feeEvents = pgTable("fee_events", {
  id: id(),
  /** network:tid:oid — a fill can only produce one fee event. */
  idempotencyKey: text("idempotency_key").notNull().unique(),
  network: networkEnum("network").notNull(),
  fillId: text("fill_id").references(() => fills.id),
  botId: text("bot_id").references(() => bots.id),
  traderUserId: text("trader_user_id").notNull().references(() => users.id),
  builderAddress: text("builder_address").notNull(),
  amountE8: e8("amount_e8").notNull(),
  /** Original string from Hyperliquid, kept for audit. */
  rawAmount: text("raw_amount").notNull(),
  feePolicyVersionId: text("fee_policy_version_id").notNull().references(() => feePolicyVersions.id),
  /** Referral snapshot at fill time. Null = no eligible partner at that tier. */
  tier1PartnerUserId: text("tier1_partner_user_id").references(() => users.id),
  tier2PartnerUserId: text("tier2_partner_user_id").references(() => users.id),
  /** OBSERVED | CONFIRMED | ALLOCATED | VOIDED */
  status: text("status").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: text("confirmed_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  index("fee_events_status_idx").on(t.status),
  check("fee_events_amount_nonneg", sql`${t.amountE8} >= 0`),
]);

export const ledgerAccountEnum = pgEnum("ledger_account", [
  "BUILDER_FEE_RECEIVABLE",
  "PLATFORM_HL_BALANCE",
  "BOT_OWNER_PAYABLE",
  "PARTNER_PAYABLE",
  "PLATFORM_NET_REVENUE",
  "UNALLOCATED_PARTNER_RESERVE",
  "ROUNDING_REMAINDER",
]);

export const ledgerEntries = pgTable("ledger_entries", {
  id: id(),
  /** Groups the balanced entries written in one transaction. */
  journalId: text("journal_id").notNull(),
  feeEventId: text("fee_event_id").references(() => feeEvents.id),
  payoutId: text("payout_id"),
  account: ledgerAccountEnum("account").notNull(),
  /** Set for per-user accounts (bot owner / partner payables). */
  accountUserId: text("account_user_id").references(() => users.id),
  /** Partner tier (1|2) for PARTNER_PAYABLE lines. */
  tier: integer("tier"),
  asset: text("asset").notNull().default("USDC"),
  /** Positive = debit, negative = credit. Each journal sums to zero. */
  amountE8: e8("amount_e8").notNull(),
  memo: text("memo"),
  createdAt: createdAt(),
}, (t) => [
  index("ledger_journal_idx").on(t.journalId),
  index("ledger_account_user_idx").on(t.account, t.accountUserId),
  index("ledger_fee_event_idx").on(t.feeEventId),
]);

export const payouts = pgTable("payouts", {
  id: id(),
  recipientUserId: text("recipient_user_id").notNull().references(() => users.id),
  recipientAddress: text("recipient_address").notNull(),
  /** BOT_OWNER_PAYABLE | PARTNER_PAYABLE */
  account: ledgerAccountEnum("account").notNull(),
  amountE8: e8("amount_e8").notNull(),
  asset: text("asset").notNull().default("USDC"),
  network: text("network").notNull(),
  /** PENDING_APPROVAL | APPROVED | PAID | FAILED | CANCELED */
  status: text("status").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  txHash: text("tx_hash"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdBy: text("created_by").notNull().references(() => users.id),
  approvedBy: text("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [check("payouts_amount_pos", sql`${t.amountE8} > 0`)]);

// ── Audit & risk ───────────────────────────────────────────────────────────

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: id(),
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  actorUserId: text("actor_user_id"),
  actorWallet: text("actor_wallet"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  createdAt: createdAt(),
});

export const riskEvents = pgTable("risk_events", {
  id: id(),
  userId: text("user_id").references(() => users.id),
  botId: text("bot_id").references(() => bots.id),
  kind: text("kind").notNull(),
  severity: text("severity").notNull(),
  detail: jsonb("detail"),
  createdAt: createdAt(),
}, (t) => [index("risk_events_created_idx").on(t.createdAt)]);

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

// ── P2P swap (docs/SWAP.md) ────────────────────────────────────────────────
// Token amounts are uint256 base units stored as numeric(78,0) strings.

const uint256 = (name: string) => numeric(name, { precision: 78, scale: 0 });

/** Settlement contract per chain, recorded only after on-chain code verification. */
export const swapDeployments = pgTable("swap_deployments", {
  chainId: integer("chain_id").primaryKey(),
  contractAddress: text("contract_address").notNull(),
  txHash: text("tx_hash").notNull(),
  deployedByUserId: text("deployed_by_user_id").notNull().references(() => users.id),
  deployer: text("deployer").notNull(),
  codeHash: text("code_hash").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
});

export const swapTokens = pgTable("swap_tokens", {
  id: id(),
  chainId: integer("chain_id").notNull(),
  /** Lowercase address. */
  address: text("address").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  decimals: integer("decimals").notNull(),
  /** true = reviewed by an admin; false = custom token added by a user. */
  listed: boolean("listed").notNull().default(false),
  addedByUserId: text("added_by_user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("swap_tokens_chain_address_uq").on(t.chainId, t.address),
  check("swap_tokens_decimals", sql`${t.decimals} between 0 and 36`),
]);

export const swapOrders = pgTable("swap_orders", {
  id: id(),
  chainId: integer("chain_id").notNull(),
  contractAddress: text("contract_address").notNull(),
  orderHash: text("order_hash").notNull(),
  makerUserId: text("maker_user_id").notNull().references(() => users.id),
  maker: text("maker").notNull(),
  sellToken: text("sell_token").notNull(),
  buyToken: text("buy_token").notNull(),
  sellAmount: uint256("sell_amount").notNull(),
  buyAmount: uint256("buy_amount").notNull(),
  taker: text("taker").notNull(),
  expiry: bigint("expiry", { mode: "number" }).notNull(),
  nonce: uint256("nonce").notNull(),
  signature: text("signature").notNull(),
  /** Mirror of on-chain state: OPEN | FILLED | CANCELLED | EXPIRED */
  status: text("status").notNull(),
  filledBuyAmount: uint256("filled_buy_amount").notNull().default("0"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("swap_orders_chain_hash_uq").on(t.chainId, t.orderHash),
  index("swap_orders_pair_idx").on(t.chainId, t.sellToken, t.buyToken, t.status),
  index("swap_orders_maker_idx").on(t.makerUserId),
]);

export const swapFills = pgTable("swap_fills", {
  id: id(),
  chainId: integer("chain_id").notNull(),
  orderHash: text("order_hash").notNull(),
  txHash: text("tx_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  blockNumber: bigint("block_number", { mode: "number" }).notNull(),
  maker: text("maker").notNull(),
  taker: text("taker").notNull(),
  sellAmountFilled: uint256("sell_amount_filled").notNull(),
  buyAmountFilled: uint256("buy_amount_filled").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("swap_fills_tx_log_uq").on(t.chainId, t.txHash, t.logIndex)]);
