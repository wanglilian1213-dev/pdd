import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCitationReportPrompt,
  parseCitationReportData,
  renderCitationReportPdf,
} from './citationReportTemplateService';

test('buildCitationReportPrompt asks for structured report data instead of plain text', () => {
  const prompt = buildCitationReportPrompt('Essay body', 'APA 7');

  assert.match(prompt.systemPrompt, /academic reference validator/i);
  assert.match(prompt.systemPrompt, /return valid json only/i);
  assert.match(prompt.systemPrompt, /overall_score/i);
  assert.match(prompt.systemPrompt, /citations/i);
  assert.match(prompt.systemPrompt, /recommendations/i);
  assert.match(prompt.userPrompt, /APA 7/);
});

test('parseCitationReportData normalizes malformed or incomplete model output', () => {
  const report = parseCitationReportData(`{
    "overall_score": 102,
    "total_citations": 2,
    "key_findings": ["Most citations align well."],
    "citations": [
      {
        "citation_label": "Citation 1",
        "source_text": "Smith (2024)",
        "score": 88,
        "assessment": "Good alignment",
        "details": [
          { "criterion": "Author", "expected": "Smith", "found": "Smith", "status": "pass" }
        ]
      }
    ]
  }`, 'APA 7');

  assert.equal(report.overallScore, 100);
  assert.equal(report.totalCitations, 2);
  assert.equal(report.citations.length, 1);
  assert.equal(report.citations[0]?.status, 'good');
  assert.equal(report.recommendations.length > 0, true);
});

test('renderCitationReportPdf returns a real PDF buffer', async () => {
  const pdfBuffer = await renderCitationReportPdf({
    reportId: 'V532-6248-2303',
    generatedAt: '2026-03-23',
    essayTitle: 'Electric Buses and Planning',
    citationStyle: 'APA 7',
    overallScore: 84,
    totalCitations: 3,
    reliabilityLabel: 'Good',
    keyFindings: ['Most sources align with the essay topic.'],
    breakdown: [
      { label: 'Excellent (90-100%)', count: 1, percentage: 33, status: 'excellent' },
      { label: 'Good (70-89%)', count: 2, percentage: 67, status: 'good' },
      { label: 'Acceptable (50-69%)', count: 0, percentage: 0, status: 'acceptable' },
      { label: 'Problematic (<50%)', count: 0, percentage: 0, status: 'problematic' },
    ],
    citations: [
      {
        citationLabel: 'Citation 1',
        sourceText: 'Smith (2024)',
        score: 84,
        status: 'good',
        assessment: 'Metadata aligns with the essay topic.',
        details: [
          { criterion: 'Author(s)', expected: 'Smith', found: 'Smith', status: 'pass' },
          { criterion: 'Year', expected: '2024', found: '2024', status: 'pass' },
        ],
      },
    ],
    recommendations: ['Double-check the final DOI formatting before submission.'],
  });

  assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF');
  assert.equal(pdfBuffer.length > 1000, true);
});

test('renderCitationReportPdf paginates cleanly for long citation analysis content', async () => {
  const longParagraph = 'This assessment keeps expanding to simulate a long validation explanation with multiple observations, caveats, and evidence statements. '.repeat(12);
  const pdfBuffer = await renderCitationReportPdf({
    reportId: 'V532-9999-3003',
    generatedAt: '2026-03-30',
    essayTitle: 'A Very Long Essay Title About Educational Policy and Institutional Reform',
    citationStyle: 'APA 7',
    overallScore: 63,
    totalCitations: 6,
    reliabilityLabel: 'Acceptable',
    keyFindings: [
      longParagraph,
      longParagraph,
      longParagraph,
    ],
    breakdown: [
      { label: 'Excellent (90-100%)', count: 1, percentage: 17, status: 'excellent' },
      { label: 'Good (70-89%)', count: 2, percentage: 33, status: 'good' },
      { label: 'Acceptable (50-69%)', count: 2, percentage: 33, status: 'acceptable' },
      { label: 'Problematic (<50%)', count: 1, percentage: 17, status: 'problematic' },
    ],
    citations: Array.from({ length: 4 }, (_, index) => ({
      citationLabel: `Citation ${index + 1}`,
      sourceText: `${longParagraph}${longParagraph}`,
      score: 60 + index,
      status: 'acceptable' as const,
      assessment: `${longParagraph}${longParagraph}`,
      details: [
        { criterion: 'Author(s)', expected: longParagraph, found: longParagraph, status: 'warning' as const },
        { criterion: 'Year', expected: '2024', found: '2024', status: 'pass' as const },
        { criterion: 'Title', expected: longParagraph, found: longParagraph, status: 'warning' as const },
        { criterion: 'Journal/Source', expected: longParagraph, found: longParagraph, status: 'warning' as const },
        { criterion: 'DOI', expected: 'https://doi.org/10.1234/example-long-doi-entry', found: 'https://doi.org/10.1234/example-long-doi-entry', status: 'pass' as const },
        { criterion: 'Relevance', expected: longParagraph, found: longParagraph, status: 'warning' as const },
      ],
    })),
    recommendations: [
      longParagraph,
      longParagraph,
      longParagraph,
    ],
  });

  const pdfText = pdfBuffer.toString('latin1');
  const pageMarkers = pdfText.match(/\/Type \/Page\b/g) ?? [];

  assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF');
  assert.equal(pageMarkers.length > 1, true);
});
