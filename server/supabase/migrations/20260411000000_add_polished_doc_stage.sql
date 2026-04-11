-- Allow 'polished' as a document_versions stage
ALTER TABLE document_versions
  DROP CONSTRAINT IF EXISTS document_versions_stage_check;

ALTER TABLE document_versions
  ADD CONSTRAINT document_versions_stage_check
  CHECK (stage IN ('draft', 'calibrated', 'verified', 'polished', 'final'));
