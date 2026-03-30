import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessGeneratedPaper,
  extractReferenceEntries,
  summarizeReferenceCompliance,
} from './paperQualityService';

test('extractReferenceEntries counts references that are listed one per line without blank lines', () => {
  const text = [
    'Argument text with citations (Smith, 2024), (Jones, 2023), and (Lee, 2022).',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
    'Jones, A. (2023). Managing evidence in academic reports. Studies in Higher Education, 18(1), 11-20. https://doi.org/10.1000/test2',
    'Lee, M. (2022). Critical analysis in short reports. Academic Review, 7(3), 21-30. https://doi.org/10.1000/test3',
  ].join('\n');

  const entries = extractReferenceEntries(text);

  assert.equal(entries.length, 3);
});

test('summarizeReferenceCompliance treats line-separated journal references as separate academic papers', () => {
  const text = [
    'Argument text with citations (Smith, 2024), (Jones, 2023), and (Lee, 2022).',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
    'Jones, A. (2023). Managing evidence in academic reports. Studies in Higher Education, 18(1), 11-20. https://doi.org/10.1000/test2',
    'Lee, M. (2022). Critical analysis in short reports. Academic Review, 7(3), 21-30. https://doi.org/10.1000/test3',
  ].join('\n');

  const summary = summarizeReferenceCompliance(text);

  assert.equal(summary.totalReferences, 3);
  assert.equal(summary.referencesFrom2020Onward, 3);
  assert.equal(summary.likelyAcademicPaperCount, 3);
  assert.equal(summary.suspectedBookCount, 0);
});

test('assessGeneratedPaper accepts valid one-line-separated references when they meet the required count', () => {
  const text = [
    'Argument text with citations (Smith, 2024), (Jones, 2023), and (Lee, 2022).',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
    'Jones, A. (2023). Managing evidence in academic reports. Studies in Higher Education, 18(1), 11-20. https://doi.org/10.1000/test2',
    'Lee, M. (2022). Critical analysis in short reports. Academic Review, 7(3), 21-30. https://doi.org/10.1000/test3',
  ].join('\n');

  const result = assessGeneratedPaper(text, {
    requiredReferenceCount: 3,
    citationStyle: 'APA 7',
  });

  assert.equal(result.valid, true);
  assert.equal(result.shouldRepair, false);
  assert.deepEqual(result.reasons, []);
});
