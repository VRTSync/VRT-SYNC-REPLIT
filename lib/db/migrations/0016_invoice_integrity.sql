-- Migration 0016: Invoice record integrity — write-path
-- Adds reference_number, source, source_batch columns and supporting indexes.
-- The unique partial index on (invoice_number, reference_number, community_id, completion_date)
-- provides DB-level idempotency for the master bill import.
-- source_batch mirrors the tasks.origin pattern so a bad import batch is
-- deletable by one predicate from both invoices and tasks.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "reference_number" varchar,
  ADD COLUMN IF NOT EXISTS "source" varchar,
  ADD COLUMN IF NOT EXISTS "source_batch" varchar;

-- DB-guaranteed idempotency key for imported invoices (partial — hand-entered
-- invoices without invoice_number or reference_number are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_source_line_unique_idx"
  ON "invoices" ("invoice_number", "reference_number", "community_id", "completion_date")
  WHERE "invoice_number" IS NOT NULL AND "reference_number" IS NOT NULL;

-- Allow fast batch-level deletes across both invoices and tasks.
CREATE INDEX IF NOT EXISTS "invoices_source_batch_idx"
  ON "invoices" ("source_batch");
