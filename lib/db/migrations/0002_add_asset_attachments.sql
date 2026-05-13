CREATE TABLE "asset_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" varchar NOT NULL,
	"community_id" varchar NOT NULL,
	"file_ref" text NOT NULL,
	"url" text NOT NULL,
	"uploaded_by" varchar NOT NULL,
	"idempotency_key" varchar NOT NULL,
	"captured_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_attachments" ADD CONSTRAINT "asset_attachments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_attachments" ADD CONSTRAINT "asset_attachments_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_attachments" ADD CONSTRAINT "asset_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_attachments_asset_idempotency_idx" ON "asset_attachments" USING btree ("asset_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_attachments_asset_idx" ON "asset_attachments" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_attachments_community_idx" ON "asset_attachments" USING btree ("community_id");
