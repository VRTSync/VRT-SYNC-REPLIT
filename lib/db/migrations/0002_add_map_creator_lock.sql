ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "is_map_creator_locked" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "map_creator_locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "map_creator_locked_by" varchar REFERENCES "users"("id") ON DELETE SET NULL;
