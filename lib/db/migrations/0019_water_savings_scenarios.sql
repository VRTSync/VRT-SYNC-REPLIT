-- Organization-owned Water Savings scenarios.
-- The nullable planner_records relationship preserves every existing admin
-- planner record while allowing future per-location records to reference a
-- portfolio scenario.

CREATE TABLE IF NOT EXISTS "water_savings_scenarios" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "target_pct" double precision NOT NULL DEFAULT 20,
  "tier" text NOT NULL DEFAULT 'rock',
  "annual_budget" double precision,
  "assumptions_json" jsonb NOT NULL,
  "pins_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" varchar REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "water_savings_scenarios_org_idx"
  ON "water_savings_scenarios" ("organization_id");

ALTER TABLE "planner_records"
  ADD COLUMN IF NOT EXISTS "scenario_id" varchar
  REFERENCES "water_savings_scenarios"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "planner_records_scenario_idx"
  ON "planner_records" ("scenario_id");