-- Migration 0017: Import Batches
-- Adds the import_batches table used by the admin seed-import page.
-- Tracks every master-bill and seasonal import run so admins can view
-- history and undo batches through the browser UI.

CREATE TABLE IF NOT EXISTS "import_batches" (
  "id"               varchar  PRIMARY KEY DEFAULT gen_random_uuid(),
  "mode"             varchar  NOT NULL,          -- 'master_bill' | 'seasonal'
  "batch_label"      varchar  NOT NULL,          -- source_batch / schedule key
  "run_by"           varchar  REFERENCES users(id) ON DELETE SET NULL,
  "run_at"           timestamp NOT NULL DEFAULT now(),
  "invoice_count"    integer,
  "task_count"       integer,
  "completion_count" integer,
  "schedule_count"   integer,
  "visit_count"      integer
);

CREATE INDEX IF NOT EXISTS "import_batches_run_at_idx" ON "import_batches"("run_at");
CREATE INDEX IF NOT EXISTS "import_batches_mode_idx"   ON "import_batches"("mode");
