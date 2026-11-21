ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "contractor_company_id" varchar;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "contractor_company_id" varchar;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "contractor_company_id" varchar;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contractor_company_id_companies_id_fk"
    FOREIGN KEY ("contractor_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contractor_company_id_companies_id_fk"
    FOREIGN KEY ("contractor_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contractor_company_id_companies_id_fk"
    FOREIGN KEY ("contractor_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_contractor_company_id_idx" ON "contracts" ("contractor_company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_contractor_company_id_idx" ON "invoices" ("contractor_company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_contractor_company_id_idx" ON "tasks" ("contractor_company_id");
--> statement-breakpoint
DO $$
DECLARE
  contracts_labeled integer;
  contracts_null integer;
  tasks_assignee integer;
  tasks_contracts integer;
  tasks_null integer;
  invoices_labeled integer;
  invoices_null integer;
BEGIN
  UPDATE contracts c SET contractor_company_id = u.company_id FROM users u
    WHERE c.contractor_user_id = u.id AND c.contractor_company_id IS NULL AND u.company_id IS NOT NULL;
  GET DIAGNOSTICS contracts_labeled = ROW_COUNT;
  UPDATE tasks t SET contractor_company_id = u.company_id FROM users u
    WHERE t.assigned_to = u.id AND u.role = 'contractor'
      AND t.contractor_company_id IS NULL AND u.company_id IS NOT NULL;
  GET DIAGNOSTICS tasks_assignee = ROW_COUNT;
  UPDATE tasks t SET contractor_company_id = h.company_id FROM (
    SELECT community_id, min(contractor_company_id) AS company_id FROM contracts
      WHERE is_active = true GROUP BY community_id
      HAVING count(DISTINCT contractor_company_id) = 1 AND count(*) = count(contractor_company_id)
  ) h WHERE t.community_id = h.community_id AND t.assigned_to IS NULL AND t.contractor_company_id IS NULL;
  GET DIAGNOSTICS tasks_contracts = ROW_COUNT;
  UPDATE invoices i SET contractor_company_id = c.id FROM companies c
    WHERE i.contractor_company_id IS NULL AND c.kind = 'contractor'
      AND c.normalized_name = trim(regexp_replace(
        regexp_replace(
          regexp_replace(replace(lower(i.contractor), '&', 'and'), '[^[:alnum:][:space:]]', '', 'g'),
          '(^|[[:space:]]+)(llc|inc|co|company|corp|corporation|ltd)[[:space:]]*$', ''),
        '[[:space:]]+', ' ', 'g'));
  GET DIAGNOSTICS invoices_labeled = ROW_COUNT;
  SELECT count(*) INTO contracts_null FROM contracts WHERE contractor_company_id IS NULL;
  SELECT count(*) INTO tasks_null FROM tasks WHERE contractor_company_id IS NULL;
  SELECT count(*) INTO invoices_null FROM invoices WHERE contractor_company_id IS NULL;
  RAISE NOTICE 'F2a counts: contracts labeled=%, contracts left null=%, tasks labeled from assignee=%, tasks labeled from contracts=%, tasks left null=%, invoices labeled=%, invoices left null=%',
    contracts_labeled, contracts_null, tasks_assignee, tasks_contracts, tasks_null, invoices_labeled, invoices_null;
END $$;
