CREATE TABLE "bot_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"order_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"coin" text NOT NULL,
	"side" text NOT NULL,
	"size" text NOT NULL,
	"entry_price" text NOT NULL,
	"stop_cloid" text,
	"opened_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"network" "hl_network" NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"coin" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb,
	"status" text NOT NULL,
	"summary" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "engine_locks" (
	"key" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_subscriptions" ADD COLUMN "order_usd" integer;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "webhook_secret_hash" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "trigger_price" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "filled_size" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "avg_price" text;--> statement-breakpoint
ALTER TABLE "bot_executions" ADD CONSTRAINT "bot_executions_signal_id_bot_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."bot_signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_executions" ADD CONSTRAINT "bot_executions_subscription_id_bot_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."bot_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_executions" ADD CONSTRAINT "bot_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD CONSTRAINT "bot_positions_subscription_id_bot_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."bot_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_signals" ADD CONSTRAINT "bot_signals_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_executions_signal_sub_uq" ON "bot_executions" USING btree ("signal_id","subscription_id");--> statement-breakpoint
CREATE INDEX "bot_executions_sub_idx" ON "bot_executions" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_positions_sub_coin_uq" ON "bot_positions" USING btree ("subscription_id","coin");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_signals_dedupe_uq" ON "bot_signals" USING btree ("bot_id","network","dedupe_key");--> statement-breakpoint
CREATE INDEX "bot_signals_bot_idx" ON "bot_signals" USING btree ("bot_id","created_at");