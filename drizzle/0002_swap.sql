CREATE TABLE "swap_deployments" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"contract_address" text NOT NULL,
	"tx_hash" text NOT NULL,
	"deployed_by_user_id" text NOT NULL,
	"deployer" text NOT NULL,
	"code_hash" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_fills" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"order_hash" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"maker" text NOT NULL,
	"taker" text NOT NULL,
	"sell_amount_filled" numeric(78, 0) NOT NULL,
	"buy_amount_filled" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"order_hash" text NOT NULL,
	"maker_user_id" text NOT NULL,
	"maker" text NOT NULL,
	"sell_token" text NOT NULL,
	"buy_token" text NOT NULL,
	"sell_amount" numeric(78, 0) NOT NULL,
	"buy_amount" numeric(78, 0) NOT NULL,
	"taker" text NOT NULL,
	"expiry" bigint NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"signature" text NOT NULL,
	"status" text NOT NULL,
	"filled_buy_amount" numeric(78, 0) DEFAULT '0' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"decimals" integer NOT NULL,
	"listed" boolean DEFAULT false NOT NULL,
	"added_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swap_tokens_decimals" CHECK ("swap_tokens"."decimals" between 0 and 36)
);
--> statement-breakpoint
ALTER TABLE "swap_deployments" ADD CONSTRAINT "swap_deployments_deployed_by_user_id_users_id_fk" FOREIGN KEY ("deployed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD CONSTRAINT "swap_orders_maker_user_id_users_id_fk" FOREIGN KEY ("maker_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_tokens" ADD CONSTRAINT "swap_tokens_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "swap_fills_tx_log_uq" ON "swap_fills" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "swap_orders_chain_hash_uq" ON "swap_orders" USING btree ("chain_id","order_hash");--> statement-breakpoint
CREATE INDEX "swap_orders_pair_idx" ON "swap_orders" USING btree ("chain_id","sell_token","buy_token","status");--> statement-breakpoint
CREATE INDEX "swap_orders_maker_idx" ON "swap_orders" USING btree ("maker_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "swap_tokens_chain_address_uq" ON "swap_tokens" USING btree ("chain_id","address");