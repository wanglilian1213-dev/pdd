ALTER TABLE humanize_jobs
  ADD COLUMN IF NOT EXISTS result_json JSONB;

ALTER TABLE standalone_humanizations
  ADD COLUMN IF NOT EXISTS result_json JSONB;
