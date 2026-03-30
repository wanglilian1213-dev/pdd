ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS required_reference_count INTEGER NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS required_section_count INTEGER NOT NULL DEFAULT 3;

ALTER TABLE outline_versions
ADD COLUMN IF NOT EXISTS required_reference_count INTEGER NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS required_section_count INTEGER NOT NULL DEFAULT 3;

UPDATE tasks
SET required_reference_count = GREATEST(1, CEIL(target_words / 1000.0))::INTEGER * 5,
    required_section_count = 3 + (GREATEST(1, CEIL(target_words / 1000.0))::INTEGER - 1)
WHERE required_reference_count IS DISTINCT FROM GREATEST(1, CEIL(target_words / 1000.0))::INTEGER * 5
   OR required_section_count IS DISTINCT FROM 3 + (GREATEST(1, CEIL(target_words / 1000.0))::INTEGER - 1);

UPDATE outline_versions
SET required_reference_count = GREATEST(1, CEIL(target_words / 1000.0))::INTEGER * 5,
    required_section_count = 3 + (GREATEST(1, CEIL(target_words / 1000.0))::INTEGER - 1)
WHERE required_reference_count IS DISTINCT FROM GREATEST(1, CEIL(target_words / 1000.0))::INTEGER * 5
   OR required_section_count IS DISTINCT FROM 3 + (GREATEST(1, CEIL(target_words / 1000.0))::INTEGER - 1);
