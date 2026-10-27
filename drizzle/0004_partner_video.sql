ALTER TYPE "public"."ledger_account" ADD VALUE 'COMPANY_BANK';--> statement-breakpoint
ALTER TYPE "public"."ledger_account" ADD VALUE 'PARTNER_CREDIT';--> statement-breakpoint
ALTER TYPE "public"."ledger_account" ADD VALUE 'VIDEO_SERVICE_REVENUE';--> statement-breakpoint
ALTER TYPE "public"."ledger_account" ADD VALUE 'PARTNER_INVOICE_PAYABLE';--> statement-breakpoint
CREATE TABLE "customer_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_user_id" text NOT NULL,
	"job_id" text,
	"issuer_name" text NOT NULL,
	"customer_name" text NOT NULL,
	"description" text NOT NULL,
	"amount_e8" bigint NOT NULL,
	"public_token" text NOT NULL,
	"reference_code" text NOT NULL,
	"status" text NOT NULL,
	"paid_confirmed_by" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_invoices_public_token_unique" UNIQUE("public_token"),
	CONSTRAINT "customer_invoices_reference_code_unique" UNIQUE("reference_code"),
	CONSTRAINT "customer_invoices_amount_pos" CHECK ("customer_invoices"."amount_e8" > 0)
);
--> statement-breakpoint
CREATE TABLE "partner_credit_topups" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_user_id" text NOT NULL,
	"requested_e8" bigint NOT NULL,
	"reference_code" text NOT NULL,
	"status" text NOT NULL,
	"approved_e8" bigint,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_credit_topups_reference_code_unique" UNIQUE("reference_code"),
	CONSTRAINT "topup_requested_pos" CHECK ("partner_credit_topups"."requested_e8" > 0)
);
--> statement-breakpoint
CREATE TABLE "partner_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_user_id" text NOT NULL,
	"amount_e8" bigint NOT NULL,
	"bank_reference" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_settlements_amount_pos" CHECK ("partner_settlements"."amount_e8" > 0)
);
--> statement-breakpoint
CREATE TABLE "video_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_user_id" text NOT NULL,
	"model" text NOT NULL,
	"resolution" text NOT NULL,
	"clip_seconds" integer NOT NULL,
	"clip_count" integer NOT NULL,
	"source_video_url" text NOT NULL,
	"frame_url" text,
	"brief" text,
	"description" text,
	"status" text NOT NULL,
	"cost_e8" bigint NOT NULL,
	"price_e8" bigint NOT NULL,
	"analysis_price_e8" bigint NOT NULL,
	"clip_price_e8" bigint NOT NULL,
	"refunded_e8" bigint DEFAULT 0 NOT NULL,
	"rights_confirmed_at" timestamp with time zone NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_outputs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"idx" integer NOT NULL,
	"prompt" text NOT NULL,
	"fal_request_id" text,
	"status" text NOT NULL,
	"video_url" text,
	"error" text,
	"refunded" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_outputs_fal_request_id_unique" UNIQUE("fal_request_id")
);
--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_partner_user_id_users_id_fk" FOREIGN KEY ("partner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_job_id_video_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_paid_confirmed_by_users_id_fk" FOREIGN KEY ("paid_confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_credit_topups" ADD CONSTRAINT "partner_credit_topups_partner_user_id_users_id_fk" FOREIGN KEY ("partner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_credit_topups" ADD CONSTRAINT "partner_credit_topups_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_partner_user_id_users_id_fk" FOREIGN KEY ("partner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_partner_user_id_users_id_fk" FOREIGN KEY ("partner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_outputs" ADD CONSTRAINT "video_outputs_job_id_video_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_invoices_partner_idx" ON "customer_invoices" USING btree ("partner_user_id");--> statement-breakpoint
CREATE INDEX "video_jobs_partner_idx" ON "video_jobs" USING btree ("partner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_outputs_job_idx_uq" ON "video_outputs" USING btree ("job_id","idx");