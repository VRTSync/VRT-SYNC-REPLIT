-- Service visit status and invoice status/aging fields (Phase 1.5)

-- service_visit_status enum
DO $$ BEGIN
  CREATE TYPE "public"."service_visit_status" AS ENUM('scheduled', 'completed', 'skipped', 'missed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- invoice_status enum
DO $$ BEGIN
  CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'submitted', 'approved', 'paid', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- status and skip_reason columns on service_visits
ALTER TABLE "service_visits" ADD COLUMN IF NOT EXISTS "status" "service_visit_status" NOT NULL DEFAULT 'scheduled';--> statement-breakpoint
ALTER TABLE "service_visits" ADD COLUMN IF NOT EXISTS "skip_reason" text;--> statement-breakpoint

-- factual backfill: rows with completed_at set are completed, not scheduled
UPDATE "service_visits" SET "status" = 'completed' WHERE "completed_at" IS NOT NULL AND "status" = 'scheduled';--> statement-breakpoint

-- index for dashboard range queries on service_visits
CREATE INDEX IF NOT EXISTS "service_visits_community_date_idx" ON "service_visits" ("community_id", "service_date");--> statement-breakpoint

-- status, invoice_number, due_date, paid_at columns on invoices
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "status" "invoice_status";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "invoice_number" varchar;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "due_date" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paid_at" timestamp;--> statement-breakpoint

-- index for invoice aging queries
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices" ("status");
