ALTER TABLE "partner_credit_topups" ADD COLUMN "fx_rate" text;--> statement-breakpoint
ALTER TABLE "partner_credit_topups" ADD COLUMN "fx_source" text;--> statement-breakpoint
ALTER TABLE "partner_credit_topups" ADD COLUMN "fx_as_of" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_credit_topups" ADD COLUMN "krw_supply" bigint;--> statement-breakpoint
ALTER TABLE "partner_credit_topups" ADD COLUMN "krw_vat" bigint;--> statement-breakpoint
ALTER TABLE "partner_credit_topups" ADD COLUMN "krw_total" bigint;