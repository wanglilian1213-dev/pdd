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

test('assessGeneratedPaper rejects repeated DOI references used to meet the required count', () => {
  const text = [
    'Argument text with citations (Smith, 2024), (Jones, 2024), and (Lee, 2024).',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/duplicate',
    'Jones, A. (2024). Managing evidence in academic reports. Studies in Higher Education, 18(1), 11-20. https://doi.org/10.1000/duplicate',
    'Lee, M. (2024). Critical analysis in short reports. Academic Review, 7(3), 21-30. https://doi.org/10.1000/duplicate',
  ].join('\n');

  const result = assessGeneratedPaper(text, {
    requiredReferenceCount: 3,
    citationStyle: 'APA 7',
  });

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('references must be distinct'), `should reject repeated DOI references, got: ${result.reasons}`);
});

test('assessGeneratedPaper rejects APA citations that are missing from the reference list', () => {
  const text = [
    'Argument text with citations (Smith, 2024), (Jones, 2023), and (Lee, 2022).',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
    'Jones, A. (2023). Managing evidence in academic reports. Studies in Higher Education, 18(1), 11-20. https://doi.org/10.1000/test2',
    'Garcia, R. (2022). Critical analysis in short reports. Academic Review, 7(3), 21-30. https://doi.org/10.1000/test3',
  ].join('\n');

  const result = assessGeneratedPaper(text, {
    requiredReferenceCount: 3,
    citationStyle: 'APA 7',
  });

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('in-text citations must match reference entries'), `should reject unmatched citation, got: ${result.reasons}`);
});

// --- hasInTextCitation expanded format tests ---

test('assessGeneratedPaper accepts Harvard without-comma citation format (Smith 2024)', () => {
  const text = [
    'Research shows significant outcomes (Smith 2024) in the field.',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 1 });

  assert.ok(!result.reasons.includes('missing citation'), `should accept Harvard without-comma format, got: ${result.reasons}`);
});

test('assessGeneratedPaper accepts numeric citation format [1]', () => {
  const text = [
    'Research shows significant outcomes [1] in multiple domains [2,3].',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
    'Jones, A. (2023). Managing evidence. Studies in Higher Education, 18(1), 11-20. https://doi.org/10.1000/test2',
    'Lee, M. (2022). Critical analysis. Academic Review, 7(3), 21-30. https://doi.org/10.1000/test3',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 3 });

  assert.ok(!result.reasons.includes('missing citation'), `should accept numeric format, got: ${result.reasons}`);
});

test('assessGeneratedPaper rejects numeric citations that exceed the reference list', () => {
  const text = [
    'Research shows significant outcomes [2] even though only one reference is listed.',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 1, citationStyle: 'Vancouver' });

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('numeric citations must match reference entries'), `should reject missing numeric reference, got: ${result.reasons}`);
});

test('assessGeneratedPaper rejects numeric-only citations for APA style', () => {
  const text = [
    'Research shows significant outcomes [1] in multiple domains.',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 1, citationStyle: 'APA 7' });

  assert.ok(result.reasons.includes('in-text citations do not appear to match APA 7 format'), `should reject numeric-only APA citation, got: ${result.reasons}`);
});

test('assessGeneratedPaper rejects mixed numeric citations for APA style', () => {
  const text = [
    'Research shows significant outcomes (Smith, 2024), but the same paragraph also uses [1].',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 1, citationStyle: 'APA 7' });

  assert.ok(result.reasons.includes('in-text citations do not appear to match APA 7 format'), `should reject mixed APA numeric citation, got: ${result.reasons}`);
});

test('assessGeneratedPaper rejects footnote citations for APA style', () => {
  const text = [
    'Research shows significant outcomes.^1',
    '',
    'Notes',
    '1. Smith, J, "Strategic writing and AI" (2024) 12 Journal of Business Writing 1.',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 1, citationStyle: 'APA 7' });

  assert.ok(result.reasons.includes('in-text citations do not appear to match APA 7 format'), `should reject APA footnote citation, got: ${result.reasons}`);
});

test('assessGeneratedPaper accepts footnote marker citation format for note-based styles', () => {
  const text = [
    'Research shows significant outcomes.^1',
    '',
    'Notes',
    '1. Smith, J, "Strategic writing and AI" (2024) 12 Journal of Business Writing 1.',
    '',
    'Bibliography',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 1, citationStyle: 'OSCOLA' });

  assert.ok(!result.reasons.includes('missing citation'), `should accept footnote marker format, got: ${result.reasons}`);
});

test('assessGeneratedPaper still flags missing citation when no citation is present', () => {
  const text = [
    'Research shows significant outcomes in the field.',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 1 });

  assert.ok(result.reasons.includes('missing citation'));
});

// --- hasResolvableLink and link detection tests ---

test('summarizeReferenceCompliance counts referencesWithLinks', () => {
  const text = [
    'Argument text with citations (Smith, 2024), (Jones, 2023).',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
    'Jones, A. (2023). Managing evidence in academic reports. Studies in Higher Education, 18(1), 11-20.',
  ].join('\n');

  const summary = summarizeReferenceCompliance(text);

  assert.equal(summary.referencesWithLinks, 1);
  assert.equal(summary.totalReferences, 2);
});

test('assessGeneratedPaper flags references missing proper links', () => {
  const text = [
    'Argument text with citations (Smith, 2024), (Jones, 2023).',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
    'Jones, A. (2023). Managing evidence in academic reports. Studies in Higher Education, 18(1), 11-20.',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 2 });

  assert.ok(result.reasons.includes('references must include proper links'), `should flag missing links, got: ${result.reasons}`);
});

test('assessGeneratedPaper accepts all references when they all have links', () => {
  const text = [
    'Argument text with citations (Smith, 2024), (Jones, 2023), and (Lee, 2022).',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
    'Jones, A. (2023). Managing evidence in academic reports. Studies in Higher Education, 18(1), 11-20. https://doi.org/10.1000/test2',
    'Lee, M. (2022). Critical analysis in short reports. Academic Review, 7(3), 21-30. https://doi.org/10.1000/test3',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 3, citationStyle: 'APA 7' });

  assert.ok(!result.reasons.includes('references must include proper links'), `should not flag when all have links, got: ${result.reasons}`);
});

test('assessGeneratedPaper accepts Chinese reference heading', () => {
  const text = [
    '正文引用了可靠研究 (Wang, 2024)。',
    '',
    '参考文献',
    'Wang, L. (2024). Digital transformation in education. Journal of Learning Research, 15(3), 45-60. https://doi.org/10.1000/test99',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 1, citationStyle: 'APA 7' });

  assert.equal(result.valid, true, `Chinese reference heading should pass, got: ${result.reasons}`);
});

// --- looksLikeAcademicPaper with hasResolvableLink ---

test('analyzeReferenceEntry treats reference with URL but no journal keyword as academic paper', () => {
  const text = [
    'Argument text with citations (Wang, 2024).',
    '',
    'References',
    'Wang, L. (2024). Digital transformation in education. 15(3), 45-60. https://doi.org/10.1000/test99',
  ].join('\n');

  const summary = summarizeReferenceCompliance(text);

  assert.equal(summary.likelyAcademicPaperCount, 1, 'reference with URL should be recognized as academic paper');
  assert.equal(summary.suspectedBookCount, 0);
});

// --- zero tolerance for book references ---

test('assessGeneratedPaper flags even a single book reference among valid ones', () => {
  const text = [
    'Argument text with citations (Smith, 2024), (Jones, 2023), and (Lee, 2022).',
    '',
    'References',
    'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
    'Jones, A. (2023). Managing evidence. Oxford University Press. ISBN 978-0-123456-78-9. https://example.com/book',
    'Lee, M. (2022). Critical analysis in short reports. Academic Review, 7(3), 21-30. https://doi.org/10.1000/test3',
  ].join('\n');

  const result = assessGeneratedPaper(text, { requiredReferenceCount: 3 });

  assert.ok(result.reasons.includes('references must be academic scholar papers, not books'), `should flag book reference, got: ${result.reasons}`);
});
