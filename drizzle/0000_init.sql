CREATE TYPE "public"."bot_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'LIVE', 'PAUSED', 'ARCHIVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('BUILDER_FEE_RECEIVABLE', 'PLATFORM_HL_BALANCE', 'BOT_OWNER_PAYABLE', 'PARTNER_PAYABLE', 'PLATFORM_NET_REVENUE', 'UNALLOCATED_PARTNER_RESERVE', 'ROUNDING_REMAINDER');--> statement-breakpoint
CREATE TYPE "public"."hl_network" AS ENUM('testnet', 'mainnet');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('TRADER', 'BOT_OWNER', 'PARTNER', 'ADMIN');--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_logs_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" text,
	"actor_wallet" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"network" "hl_network" NOT NULL,
	"agent_address" text NOT NULL,
	"agent_name" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_authorizations_agent_address_unique" UNIQUE("agent_address")
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_performance_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"period" text NOT NULL,
	"verification" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"methodology" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_review_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"from_status" "bot_status" NOT NULL,
	"to_status" "bot_status" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"user_id" text NOT NULL,
	"network" "hl_network" NOT NULL,
	"status" text NOT NULL,
	"accepted_fee_tenths_bp" integer NOT NULL,
	"accepted_config_version" integer NOT NULL,
	"pending_fee_tenths_bp" integer,
	"consented_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"version" integer NOT NULL,
	"config_hash" text NOT NULL,
	"config" jsonb NOT NULL,
	"fee_tenths_bp" integer NOT NULL,
	"changed_by" text NOT NULL,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bots" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_wallet_address" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text NOT NULL,
	"status" "bot_status" DEFAULT 'DRAFT' NOT NULL,
	"strategy_type" text NOT NULL,
	"fee_tenths_bp" integer NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"risk_level" text NOT NULL,
	"live_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bots_slug_unique" UNIQUE("slug"),
	CONSTRAINT "bots_fee_range" CHECK ("bots"."fee_tenths_bp" >= 0 and "bots"."fee_tenths_bp" <= 100)
);
--> statement-breakpoint
CREATE TABLE "builder_fee_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"network" "hl_network" NOT NULL,
	"builder_address" text NOT NULL,
	"max_fee_tenths_bp" integer NOT NULL,
	"verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_events" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"network" "hl_network" NOT NULL,
	"fill_id" text,
	"bot_id" text,
	"trader_user_id" text NOT NULL,
	"builder_address" text NOT NULL,
	"amount_e8" bigint NOT NULL,
	"raw_amount" text NOT NULL,
	"fee_policy_version_id" text NOT NULL,
	"tier1_partner_user_id" text,
	"tier2_partner_user_id" text,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_events_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "fee_events_amount_nonneg" CHECK ("fee_events"."amount_e8" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fee_policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"bot_owner_share_ppm" integer NOT NULL,
	"platform_share_of_pool_ppm" integer NOT NULL,
	"tier1_share_of_partner_pool_ppm" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"approved_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_policy_versions_version_unique" UNIQUE("version"),
	CONSTRAINT "fee_policy_ranges" CHECK ("fee_policy_versions"."bot_owner_share_ppm" between 0 and 1000000
    and "fee_policy_versions"."platform_share_of_pool_ppm" between 0 and 1000000
    and "fee_policy_versions"."tier1_share_of_partner_pool_ppm" between 0 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" text PRIMARY KEY NOT NULL,
	"network" "hl_network" NOT NULL,
	"hl_address" text NOT NULL,
	"tid" bigint NOT NULL,
	"hl_order_id" bigint NOT NULL,
	"order_id" text,
	"bot_id" text,
	"user_id" text,
	"coin" text NOT NULL,
	"side" text NOT NULL,
	"price" text NOT NULL,
	"size" text NOT NULL,
	"closed_pnl" text NOT NULL,
	"fee" text NOT NULL,
	"builder_fee" text,
	"fee_token" text NOT NULL,
	"hash" text NOT NULL,
	"crossed" boolean NOT NULL,
	"source_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_id" text NOT NULL,
	"fee_event_id" text,
	"payout_id" text,
	"account" "ledger_account" NOT NULL,
	"account_user_id" text,
	"tier" integer,
	"asset" text DEFAULT 'USDC' NOT NULL,
	"amount_e8" bigint NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"bot_id" text,
	"subscription_id" text,
	"source" text NOT NULL,
	"network" "hl_network" NOT NULL,
	"hl_address" text NOT NULL,
	"cloid" text NOT NULL,
	"hl_order_id" bigint,
	"coin" text NOT NULL,
	"side" text NOT NULL,
	"order_type" text NOT NULL,
	"price" text NOT NULL,
	"size" text NOT NULL,
	"reduce_only" boolean DEFAULT false NOT NULL,
	"builder_fee_tenths_bp" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_cloid_unique" UNIQUE("cloid")
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"referral_code" text NOT NULL,
	"eligibility_status" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "partners_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_user_id" text NOT NULL,
	"recipient_address" text NOT NULL,
	"account" "ledger_account" NOT NULL,
	"amount_e8" bigint NOT NULL,
	"asset" text DEFAULT 'USDC' NOT NULL,
	"network" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"tx_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payouts_amount_pos" CHECK ("payouts"."amount_e8" > 0)
);
--> statement-breakpoint
CREATE TABLE "positions_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"bot_id" text,
	"network" "hl_network" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_relations" (
	"trader_user_id" text PRIMARY KEY NOT NULL,
	"direct_partner_user_id" text NOT NULL,
	"indirect_partner_user_id" text,
	"referral_code" text NOT NULL,
	"frozen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "referral_no_self" CHECK ("referral_relations"."trader_user_id" <> "referral_relations"."direct_partner_user_id")
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"bot_id" text,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "trading_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"network" "hl_network" NOT NULL,
	"hl_address" text NOT NULL,
	"last_fill_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address"),
	CONSTRAINT "users_wallet_lower" CHECK ("users"."wallet_address" = lower("users"."wallet_address"))
);
--> statement-breakpoint
ALTER TABLE "agent_authorizations" ADD CONSTRAINT "agent_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_performance_snapshots" ADD CONSTRAINT "bot_performance_snapshots_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_review_logs" ADD CONSTRAINT "bot_review_logs_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_review_logs" ADD CONSTRAINT "bot_review_logs_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_subscriptions" ADD CONSTRAINT "bot_subscriptions_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_subscriptions" ADD CONSTRAINT "bot_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_versions" ADD CONSTRAINT "bot_versions_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_versions" ADD CONSTRAINT "bot_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bots" ADD CONSTRAINT "bots_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_fee_approvals" ADD CONSTRAINT "builder_fee_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_fill_id_fills_id_fk" FOREIGN KEY ("fill_id") REFERENCES "public"."fills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_trader_user_id_users_id_fk" FOREIGN KEY ("trader_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_fee_policy_version_id_fee_policy_versions_id_fk" FOREIGN KEY ("fee_policy_version_id") REFERENCES "public"."fee_policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_tier1_partner_user_id_users_id_fk" FOREIGN KEY ("tier1_partner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_tier2_partner_user_id_users_id_fk" FOREIGN KEY ("tier2_partner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_policy_versions" ADD CONSTRAINT "fee_policy_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_fee_event_id_fee_events_id_fk" FOREIGN KEY ("fee_event_id") REFERENCES "public"."fee_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_user_id_users_id_fk" FOREIGN KEY ("account_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_subscription_id_bot_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."bot_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions_snapshots" ADD CONSTRAINT "positions_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions_snapshots" ADD CONSTRAINT "positions_snapshots_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_relations" ADD CONSTRAINT "referral_relations_trader_user_id_users_id_fk" FOREIGN KEY ("trader_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_relations" ADD CONSTRAINT "referral_relations_direct_partner_user_id_users_id_fk" FOREIGN KEY ("direct_partner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_relations" ADD CONSTRAINT "referral_relations_indirect_partner_user_id_users_id_fk" FOREIGN KEY ("indirect_partner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_auth_user_idx" ON "agent_authorizations" USING btree ("user_id","network");--> statement-breakpoint
CREATE INDEX "bot_perf_bot_idx" ON "bot_performance_snapshots" USING btree ("bot_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_subscriptions_bot_user_net_uq" ON "bot_subscriptions" USING btree ("bot_id","user_id","network");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_versions_bot_version_uq" ON "bot_versions" USING btree ("bot_id","version");--> statement-breakpoint
CREATE INDEX "bots_status_idx" ON "bots" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bots_owner_idx" ON "bots" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "builder_fee_approvals_uq" ON "builder_fee_approvals" USING btree ("user_id","network","builder_address");--> statement-breakpoint
CREATE INDEX "fee_events_status_idx" ON "fee_events" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "fills_network_tid_oid_uq" ON "fills" USING btree ("network","tid","hl_order_id");--> statement-breakpoint
CREATE INDEX "fills_bot_idx" ON "fills" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX "ledger_journal_idx" ON "ledger_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "ledger_account_user_idx" ON "ledger_entries" USING btree ("account","account_user_id");--> statement-breakpoint
CREATE INDEX "ledger_fee_event_idx" ON "ledger_entries" USING btree ("fee_event_id");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_bot_idx" ON "orders" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX "referral_direct_idx" ON "referral_relations" USING btree ("direct_partner_user_id");--> statement-breakpoint
CREATE INDEX "referral_indirect_idx" ON "referral_relations" USING btree ("indirect_partner_user_id");--> statement-breakpoint
CREATE INDEX "risk_events_created_idx" ON "risk_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_accounts_user_net_uq" ON "trading_accounts" USING btree ("user_id","network");