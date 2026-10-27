CREATE TABLE "bot_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"sha256" text NOT NULL,
	"language" text NOT NULL,
	"code" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_sources" ADD CONSTRAINT "bot_sources_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_sources" ADD CONSTRAINT "bot_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_sources_bot_sha_uq" ON "bot_sources" USING btree ("bot_id","sha256");