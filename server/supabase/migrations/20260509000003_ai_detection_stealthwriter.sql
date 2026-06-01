ALTER TABLE ai_detections
  ADD COLUMN IF NOT EXISTS human_score INTEGER,
  ADD COLUMN IF NOT EXISTS scan_version TEXT,
  ADD COLUMN IF NOT EXISTS stealthwriter_result_id TEXT;
