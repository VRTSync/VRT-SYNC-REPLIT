-- No backfill. Existing contract holders, task schedules and sessions are untouched.
DO $$ BEGIN
  CREATE TYPE contract_service_kind AS ENUM ('counted','repeating','as_needed','on_request');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE service_category AS ENUM ('landscape','irrigation','tree','snow');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE contracts ALTER COLUMN contractor_user_id DROP NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contract_services (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id varchar NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  name text NOT NULL CONSTRAINT contract_services_name_length CHECK (length(name) BETWEEN 1 AND 120),
  description text CONSTRAINT contract_services_description_length CHECK (length(description) <= 500),
  category service_category NOT NULL,
  kind contract_service_kind NOT NULL,
  included_text text CONSTRAINT contract_services_included_length CHECK (length(included_text) <= 60),
  cadence_text text CONSTRAINT contract_services_cadence_length CHECK (length(cadence_text) <= 160),
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contract_service_windows (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id varchar NOT NULL REFERENCES contract_services(id) ON DELETE CASCADE,
  seq integer NOT NULL CONSTRAINT contract_service_windows_seq CHECK (seq > 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  archived_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT contract_service_windows_dates CHECK (start_date <= end_date)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contract_service_completions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id varchar NOT NULL REFERENCES contract_service_windows(id) ON DELETE RESTRICT,
  completed_on date NOT NULL,
  completed_by varchar NOT NULL REFERENCES users(id),
  note text CONSTRAINT contract_service_completions_note_length CHECK (length(note) <= 1000),
  created_at timestamp NOT NULL DEFAULT now(),
  undone_at timestamp,
  undone_by varchar REFERENCES users(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contract_completion_photos (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id varchar NOT NULL REFERENCES contract_service_completions(id) ON DELETE CASCADE,
  object_path text NOT NULL,
  idempotency_key text NOT NULL,
  uploaded_by varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contract_rates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id varchar NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  label text NOT NULL CONSTRAINT contract_rates_label_length CHECK (length(label) BETWEEN 1 AND 120),
  amount_cents integer NOT NULL CONSTRAINT contract_rates_amount CHECK (amount_cents >= 0),
  unit text CONSTRAINT contract_rates_unit_length CHECK (length(unit) <= 40),
  note text CONSTRAINT contract_rates_note_length CHECK (length(note) <= 200),
  sort_order integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_services_contract_sort_idx ON contract_services(contract_id,sort_order);
--> statement-breakpoint
-- Archived history may retain its old seq without competing with active windows.
CREATE UNIQUE INDEX IF NOT EXISTS contract_service_windows_active_seq_idx ON contract_service_windows(service_id,seq) WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_service_windows_dates_idx ON contract_service_windows(start_date,end_date);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS contract_service_completions_live_idx ON contract_service_completions(window_id) WHERE undone_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_service_completions_window_idx ON contract_service_completions(window_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS contract_completion_photos_key_idx ON contract_completion_photos(completion_id,idempotency_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_rates_contract_sort_idx ON contract_rates(contract_id,sort_order);
