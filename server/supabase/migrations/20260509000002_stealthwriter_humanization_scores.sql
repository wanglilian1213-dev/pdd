ALTER TABLE humanize_jobs
  ADD COLUMN IF NOT EXISTS final_human_score INTEGER,
  ADD COLUMN IF NOT EXISTS scan_version TEXT,
  ADD COLUMN IF NOT EXISTS humanize_more_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stealthwriter_result_id TEXT;

ALTER TABLE standalone_humanizations
  ADD COLUMN IF NOT EXISTS final_human_score INTEGER,
  ADD COLUMN IF NOT EXISTS scan_version TEXT,
  ADD COLUMN IF NOT EXISTS humanize_more_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stealthwriter_result_id TEXT;
