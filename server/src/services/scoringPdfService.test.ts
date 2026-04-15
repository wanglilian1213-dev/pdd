import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScoringReportData,
  renderScoringReportPdf,
  type ScoringReportData,
} from './scoringPdfService';
import type { ScoringResult } from './scoringPromptService';

function buildSampleResult(): ScoringResult {
  return {
    overall_score: 80,
    overall_comment:
      'Solid paper that meets the brief. The argument is coherent and evidence is well integrated.',
    dimensions: [
      {
        name: 'Content & argument',
        weight: 30,
        score: 80,
        strengths: ['Clear central argument.', 'Position stated early.'],
        weaknesses: ['No substantive weaknesses identified.'],
        suggestions: ['Consider one more counter-argument in section 2.'],
      },
      {
        name: 'Argumentation & evidence',
        weight: 25,
        score: 78,
        strengths: ['Post-2020 sources well integrated.'],
        weaknesses: [],
        suggestions: ['Quantify the impact in section 3.'],
      },
      {
        name: 'Structure & logic',
        weight: 20,
        score: 82,
        strengths: ['Logical flow.'],
        weaknesses: [],
        suggestions: ['Tighten the conclusion.'],
      },
      {
        name: 'Language & expression',
        weight: 15,
        score: 80,
        strengths: ['Readable prose.'],
        weaknesses: [],
        suggestions: ['Vary sentence openers.'],
      },
      {
        name: 'Citation format',
        weight: 10,
        score: 82,
        strengths: ['APA 7 is consistent.'],
        weaknesses: [],
        suggestions: ['Double-check DOI links.'],
      },
    ],
    top_suggestions: [
      'Add one counter-argument in section 2.',
      'Quantify findings where possible.',
      'Tighten the conclusion.',
    ],
    detected_files: [
      { filename: 'essay.docx', role: 'article', note: '' },
      { filename: 'rubric.pdf', role: 'rubric', note: '' },
    ],
  };
}

// ---------------------------------------------------------------------------
// buildScoringReportData
// ---------------------------------------------------------------------------

test('buildScoringReportData: passes through fields and stamps current time', () => {
  const result = buildSampleResult();
  const data = buildScoringReportData(result, 'rubric', 'essay');
  assert.equal(data.result, result);
  assert.equal(data.scenario, 'rubric');
  assert.equal(data.articleTitle, 'essay');
  assert.ok(data.generatedAt instanceof Date);
});

// ---------------------------------------------------------------------------
// renderScoringReportPdf
// ---------------------------------------------------------------------------

test('renderScoringReportPdf: rubric scenario produces non-empty PDF buffer', async () => {
  const data = buildScoringReportData(buildSampleResult(), 'rubric', 'essay');
  const buf = await renderScoringReportPdf(data);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500, `expected PDF length > 500, got ${buf.length}`);
  // PDF files start with %PDF-
  assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-');
});

test('renderScoringReportPdf: article_only scenario also renders', async () => {
  const data = buildScoringReportData(buildSampleResult(), 'article_only', null);
  const buf = await renderScoringReportPdf(data);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500);
  assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-');
});

test('renderScoringReportPdf: brief_only scenario renders without article title', async () => {
  const data = buildScoringReportData(buildSampleResult(), 'brief_only', null);
  const buf = await renderScoringReportPdf(data);
  assert.ok(buf.length > 500);
});

test('renderScoringReportPdf: tolerates 10 dimensions without crashing (pagination)', async () => {
  const result = buildSampleResult();
  // Expand to 10 dimensions and long strings to force page break
  result.dimensions = Array.from({ length: 10 }).map((_, i) => ({
    name: `Dim ${i + 1} — long dimension name to exercise wrapping`,
    weight: 10,
    score: 80,
    strengths: [
      'A lengthy strength statement that should wrap across multiple lines to exercise heightOfString based measurement in the pdf renderer. '.repeat(3),
    ],
    weaknesses: ['No substantive weaknesses identified.'],
    suggestions: [
      'A concrete actionable suggestion item that should also wrap. '.repeat(2),
    ],
  }));
  const data = buildScoringReportData(result, 'rubric', 'stress test');
  const buf = await renderScoringReportPdf(data);
  assert.ok(buf.length > 1000);
  assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-');
});

test('renderScoringReportPdf: detected_files note rendered when present', async () => {
  const result = buildSampleResult();
  result.detected_files = [
    { filename: 'essay.docx', role: 'article', note: 'Overrode hinted role rubric.' },
    { filename: 'rubric.pdf', role: 'rubric', note: '' },
  ];
  const data: ScoringReportData = buildScoringReportData(result, 'rubric', 'essay');
  const buf = await renderScoringReportPdf(data);
  assert.ok(buf.length > 500);
});
