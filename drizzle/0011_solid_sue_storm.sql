ALTER TABLE "fee_events" ADD COLUMN "wholesaler_portion_ppm" integer;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "kind" text DEFAULT 'WHOLESALE' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "wholesaler_user_id" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "affiliate_invite_code" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "wholesaler_portion_ppm" integer;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_wholesaler_user_id_users_id_fk" FOREIGN KEY ("wholesaler_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_affiliate_invite_code_unique" UNIQUE("affiliate_invite_code");--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_kind" CHECK ("partners"."kind" in ('WHOLESALE', 'AFFILIATE'));--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_portion_range" CHECK ("partners"."wholesaler_portion_ppm" is null or "partners"."wholesaler_portion_ppm" between 0 and 1000000);--> statement-breakpoint
-- Wholesale + affiliate model (docs/FEE_POLICY.md): owner 70% / pool 30%; pool → platform 30% (9% of the fee)
-- and partners 70% (21%). Applies from the moment this migration runs; earlier fills keep their policy.
-- tier1 share (600000) only matters for fee events recorded before the wholesale model.
INSERT INTO fee_policy_versions
  (id, version, bot_owner_share_ppm, platform_share_of_pool_ppm, tier1_share_of_partner_pool_ppm,
   effective_from, status, note)
SELECT 'policy-wholesale-2026-10-30', coalesce(max(version), 0) + 1, 700000, 300000, 600000, now(), 'ACTIVE',
       '70 / 9 / 21: wholesale partner + affiliate share 21%'
FROM fee_policy_versions;
