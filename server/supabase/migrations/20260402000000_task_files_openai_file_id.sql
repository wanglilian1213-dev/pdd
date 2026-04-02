-- Add openai_file_id column to task_files for cross-stage file reuse.
-- When materials are uploaded to OpenAI, the returned file ID is persisted here
-- so that subsequent pipeline stages can reuse the same file without re-uploading.

ALTER TABLE task_files
ADD COLUMN IF NOT EXISTS openai_file_id TEXT;
