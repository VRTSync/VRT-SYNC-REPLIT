ALTER TABLE assets ADD COLUMN IF NOT EXISTS captured_accuracy_m numeric(6,2);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS captured_sample_count integer;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS captured_at timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS captured_device_model text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS captured_under_canopy boolean DEFAULT false;
