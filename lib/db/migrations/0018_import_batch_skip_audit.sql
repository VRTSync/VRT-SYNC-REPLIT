-- Migration 0018: Import batch skip audit
-- Persists the structured skipped-row report and the explicitly acknowledged
-- unmatched PNC codes for each import batch. Without this, a batch record only
-- carries aggregate counts, so a later auditor cannot answer "why is this
-- property missing from this billing period?" without the original upload.
--
-- Both columns are additive and nullable; existing batch rows keep NULL.

ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "skipped_rows" jsonb;
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "acknowledged_codes" jsonb;
