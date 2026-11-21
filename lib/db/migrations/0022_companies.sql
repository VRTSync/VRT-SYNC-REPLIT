-- Generated from the schema, limited to F1a: earlier migrations already cover
-- the unrelated differences from the historical 0001 snapshot.
DO $$ BEGIN
  CREATE TYPE "public"."company_kind" AS ENUM ('contractor', 'management_company');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "kind" "company_kind" NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_id" varchar;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_normalized_name_idx" ON "companies" ("normalized_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_company_id_idx" ON "users" ("company_id");
--> statement-breakpoint
DO $$
DECLARE
  company_created integer;
  contractors_labeled integer;
  hoa_added integer;
  hoa_removed integer;
  pms_unlabeled integer;
  company_id_value varchar;
  seed_name text := 'High Plains Property Maintenance';
  normalized text;
BEGIN
  -- Same ordered rules as normalizeCompanyName: lower, &, punctuation, one
  -- trailing suffix, whitespace. No permanent function is needed.
  normalized := trim(regexp_replace(
    regexp_replace(
      regexp_replace(replace(lower(seed_name), '&', 'and'), '[^[:alnum:][:space:]]', '', 'g'),
      '(^|[[:space:]]+)(llc|inc|co|company|corp|corporation|ltd)[[:space:]]*$', ''),
    '[[:space:]]+', ' ', 'g'));
  INSERT INTO companies (name, normalized_name, kind)
    VALUES (seed_name, normalized, 'contractor')
    ON CONFLICT (normalized_name) DO NOTHING;
  GET DIAGNOSTICS company_created = ROW_COUNT;
  SELECT id INTO company_id_value FROM companies WHERE normalized_name = normalized;

  UPDATE users SET company_id = company_id_value
    WHERE role = 'contractor' AND company_id IS NULL;
  GET DIAGNOSTICS contractors_labeled = ROW_COUNT;

  INSERT INTO community_members (community_id, user_id)
    SELECT hoa_community_id, id FROM users
    WHERE role IN ('hoa_admin', 'hoa_member') AND hoa_community_id IS NOT NULL
    ON CONFLICT (community_id, user_id) DO NOTHING;
  GET DIAGNOSTICS hoa_added = ROW_COUNT;

  DELETE FROM community_members m USING users u
    WHERE m.user_id = u.id AND u.role IN ('hoa_admin', 'hoa_member')
      AND u.hoa_community_id IS NOT NULL AND m.community_id <> u.hoa_community_id;
  GET DIAGNOSTICS hoa_removed = ROW_COUNT;
  SELECT count(*) INTO pms_unlabeled FROM users
    WHERE role = 'property_manager' AND company_id IS NULL;
  RAISE NOTICE 'F1a counts: company created=%, contractor users labeled=%, HOA rows added=%, stale HOA rows removed=%, property managers without a company=%',
    company_created, contractors_labeled, hoa_added, hoa_removed, pms_unlabeled;
END $$;
