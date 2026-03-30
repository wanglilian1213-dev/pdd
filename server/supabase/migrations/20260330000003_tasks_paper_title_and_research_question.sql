ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS paper_title TEXT,
ADD COLUMN IF NOT EXISTS research_question TEXT;

ALTER TABLE outline_versions
ADD COLUMN IF NOT EXISTS paper_title TEXT,
ADD COLUMN IF NOT EXISTS research_question TEXT;

UPDATE tasks AS t
SET
  paper_title = ov.paper_title,
  research_question = ov.research_question
FROM (
  SELECT DISTINCT ON (task_id)
    task_id,
    paper_title,
    research_question
  FROM outline_versions
  WHERE paper_title IS NOT NULL OR research_question IS NOT NULL
  ORDER BY task_id, version DESC, created_at DESC
) AS ov
WHERE t.id = ov.task_id
  AND (t.paper_title IS NULL OR t.research_question IS NULL);
