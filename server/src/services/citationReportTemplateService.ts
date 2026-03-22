import PDFDocument from 'pdfkit';

type CitationStatus = 'excellent' | 'good' | 'acceptable' | 'problematic';
type CriterionStatus = 'pass' | 'warning' | 'fail';

interface CitationReportPrompt {
  systemPrompt: string;
  userPrompt: string;
}

interface CitationDetail {
  criterion: string;
  expected: string;
  found: string;
  status: CriterionStatus;
}

interface CitationEntry {
  citationLabel: string;
  sourceText: string;
  score: number;
  status: CitationStatus;
  assessment: string;
  details: CitationDetail[];
}

interface CitationBreakdownRow {
  label: string;
  count: number;
  percentage: number;
  status: CitationStatus;
}

export interface CitationReportData {
  reportId: string;
  generatedAt: string;
  essayTitle: string;
  citationStyle: string;
  overallScore: number;
  totalCitations: number;
  reliabilityLabel: string;
  keyFindings: string[];
  breakdown: CitationBreakdownRow[];
  citations: CitationEntry[];
  recommendations: string[];
}

function normalizeCriterionStatus(value: unknown): CriterionStatus {
  if (value === 'pass' || value === 'warning' || value === 'fail') {
    return value;
  }

  return 'warning';
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getStatusFromScore(score: number): CitationStatus {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'acceptable';
  return 'problematic';
}

function getReliabilityLabel(score: number) {
  const status = getStatusFromScore(score);
  switch (status) {
    case 'excellent':
      return 'Excellent';
    case 'good':
      return 'Good';
    case 'acceptable':
      return 'Acceptable';
    default:
      return 'Problematic';
  }
}

function safeJsonParse(content: string) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function buildCitationReportPrompt(text: string, citationStyle: string): CitationReportPrompt {
  return {
    systemPrompt: `You are an expert academic reference validator specializing in academic citation checking.
Return valid JSON only.

Use a professional, objective, constructive tone.
Focus on practical validation based on the essay text and the available citation information inside the essay.

Return JSON in this shape:
{
  "overall_score": number,
  "total_citations": number,
  "key_findings": ["string"],
  "citations": [
    {
      "citation_label": "string",
      "source_text": "string",
      "score": number,
      "assessment": "string",
      "details": [
        {
          "criterion": "Author(s)",
          "expected": "string",
          "found": "string",
          "status": "pass|warning|fail"
        }
      ]
    }
  ],
  "recommendations": ["string"]
}`,
    userPrompt: `Analyze the following essay and prepare a professional citation validation report for ${citationStyle}.

Essay content:
${text}`,
  };
}

export function parseCitationReportData(
  content: string,
  citationStyle: string,
): Omit<CitationReportData, 'reportId' | 'generatedAt' | 'essayTitle' | 'citationStyle'> {
  const parsed = safeJsonParse(content);
  const rawCitations = Array.isArray(parsed?.citations) ? parsed!.citations as Array<Record<string, unknown>> : [];
  const citations: CitationEntry[] = rawCitations.map((citation, index) => {
    const score = clampScore(Number(citation.score ?? 0));
    const details = Array.isArray(citation.details) ? citation.details as Array<Record<string, unknown>> : [];
    const normalizedDetails: CitationDetail[] = details.length > 0
      ? details.map((detail) => ({
          criterion: String(detail.criterion ?? 'Criterion'),
          expected: String(detail.expected ?? 'Not specified'),
          found: String(detail.found ?? 'Not specified'),
          status: normalizeCriterionStatus(detail.status),
        }))
      : [{
          criterion: 'Citation format',
          expected: `${citationStyle} consistency`,
          found: 'Limited data available',
          status: 'warning',
        }];

    return {
      citationLabel: String(citation.citation_label ?? `Citation ${index + 1}`),
      sourceText: String(citation.source_text ?? 'Source text not provided'),
      score,
      status: getStatusFromScore(score),
      assessment: String(citation.assessment ?? 'No detailed assessment provided.'),
      details: normalizedDetails,
    };
  });

  const totalCitations = Number(parsed?.total_citations ?? citations.length ?? 0);
  const overallScore = clampScore(Number(parsed?.overall_score ?? (citations.length > 0
    ? citations.reduce((sum, citation) => sum + citation.score, 0) / citations.length
    : 0)));
  const keyFindings = Array.isArray(parsed?.key_findings) && parsed?.key_findings.length > 0
    ? parsed!.key_findings.map((item) => String(item))
    : ['The report was generated from the available citation information in the essay.'];
  const recommendations = Array.isArray(parsed?.recommendations) && parsed?.recommendations.length > 0
    ? parsed!.recommendations.map((item) => String(item))
    : ['Review the references section once more before final submission.'];

  const breakdownDefinitions: Array<{ label: string; status: CitationStatus }> = [
    { label: 'Excellent (90-100%)', status: 'excellent' },
    { label: 'Good (70-89%)', status: 'good' },
    { label: 'Acceptable (50-69%)', status: 'acceptable' },
    { label: 'Problematic (<50%)', status: 'problematic' },
  ];

  const breakdown = breakdownDefinitions.map((definition) => {
    const count = citations.filter((citation) => citation.status === definition.status).length;
    const denominator = totalCitations > 0 ? totalCitations : 1;
    return {
      label: definition.label,
      count,
      percentage: Math.round((count / denominator) * 100),
      status: definition.status,
    };
  });

  return {
    overallScore,
    totalCitations,
    reliabilityLabel: getReliabilityLabel(overallScore),
    keyFindings,
    breakdown,
    citations,
    recommendations,
  };
}

const COLORS = {
  navy: '#243B7B',
  indigo: '#5267D8',
  softBlue: '#EDF2FF',
  border: '#D8E0F2',
  text: '#1E293B',
  muted: '#64748B',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  white: '#FFFFFF',
  light: '#F8FAFC',
};

function drawRoundedCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, fillColor: string) {
  doc.save();
  doc.roundedRect(x, y, width, height, 14).fill(fillColor);
  doc.restore();
}

function ensureSpace(doc: PDFKit.PDFDocument, heightNeeded: number) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + heightNeeded <= bottomLimit) {
    return;
  }

  doc.addPage();
}

function statusColor(status: CitationStatus | CriterionStatus) {
  switch (status) {
    case 'excellent':
    case 'good':
    case 'pass':
      return COLORS.success;
    case 'acceptable':
    case 'warning':
      return COLORS.warning;
    default:
      return COLORS.danger;
  }
}

function renderHeader(doc: PDFKit.PDFDocument, data: CitationReportData) {
  doc.save();
  doc.rect(0, 0, doc.page.width, 88).fill(COLORS.navy);
  doc.restore();

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(20)
    .text('VeritasScan', 50, 28);

  doc
    .font('Helvetica')
    .fontSize(10)
    .text(data.reportId, doc.page.width - 190, 32, {
      width: 140,
      align: 'center',
    });

  doc.y = 112;
  doc
    .fillColor(COLORS.text)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('Academic Misconduct Risk Assessment Report');
  doc
    .moveDown(0.2)
    .font('Helvetica')
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text(`Report generated on ${data.generatedAt}`);
  doc
    .moveDown(0.2)
    .text(`Essay title: ${data.essayTitle}`);
  doc
    .moveDown(0.2)
    .text(`Citation style reviewed: ${data.citationStyle}`);
  doc.moveDown(1);
}

function renderExecutiveSummary(doc: PDFKit.PDFDocument, data: CitationReportData) {
  ensureSpace(doc, 180);
  const top = doc.y;
  drawRoundedCard(doc, 50, top, 495, 140, COLORS.softBlue);

  doc
    .fillColor(COLORS.text)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('Executive Summary', 70, top + 18);

  doc
    .font('Helvetica-Bold')
    .fontSize(28)
    .fillColor(COLORS.indigo)
    .text(`${data.overallScore}%`, 75, top + 55);

  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(COLORS.muted)
    .text('Overall validation score', 78, top + 92);

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(COLORS.text)
    .text(`Total citations: ${data.totalCitations}`, 210, top + 52);
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(`Reliability: ${data.reliabilityLabel}`, 210, top + 74);

  let findingsY = top + 30;
  for (const finding of data.keyFindings.slice(0, 3)) {
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(`• ${finding}`, 335, findingsY, { width: 180 });
    findingsY += 28;
  }

  doc.y = top + 160;
}

function renderBreakdownTable(doc: PDFKit.PDFDocument, data: CitationReportData) {
  ensureSpace(doc, 160);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.text).text('Validation Overview');
  doc.moveDown(0.5);

  const startX = 50;
  const widths = [210, 60, 70, 80, 75];
  const headers = ['Category', 'Count', 'Percentage', 'Visual Bar', 'Status'];
  let x = startX;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.muted);
  headers.forEach((header, index) => {
    doc.text(header, x, doc.y, { width: widths[index] });
    x += widths[index];
  });
  doc.moveDown(0.8);

  data.breakdown.forEach((row) => {
    ensureSpace(doc, 28);
    const rowY = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text(row.label, startX, rowY, { width: widths[0] });
    doc.text(String(row.count), startX + widths[0], rowY, { width: widths[1] });
    doc.text(`${row.percentage}%`, startX + widths[0] + widths[1], rowY, { width: widths[2] });

    const barX = startX + widths[0] + widths[1] + widths[2];
    doc.save();
    doc.roundedRect(barX, rowY + 4, 65, 8, 4).fill('#E5EAF6');
    doc.roundedRect(barX, rowY + 4, Math.max(4, row.percentage * 0.65), 8, 4).fill(statusColor(row.status));
    doc.restore();

    doc.fillColor(statusColor(row.status)).text(row.status.toUpperCase(), startX + widths[0] + widths[1] + widths[2] + widths[3], rowY, { width: widths[4] });
    doc.y = rowY + 22;
  });

  doc.moveDown(1);
}

function renderCitationCard(doc: PDFKit.PDFDocument, citation: CitationEntry, index: number) {
  ensureSpace(doc, 200);
  const top = doc.y;
  const cardHeight = 150 + (citation.details.length * 18);
  drawRoundedCard(doc, 50, top, 495, cardHeight, COLORS.white);
  doc.save();
  doc.roundedRect(50, top, 495, cardHeight, 14).stroke(COLORS.border);
  doc.restore();

  doc.save();
  doc.roundedRect(50, top, 495, 26, 14).fill(COLORS.indigo);
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.white).text(`Citation ${index + 1}: ${citation.citationLabel}`, 64, top + 8);

  let y = top + 38;
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11).text('Source text', 64, y);
  y += 16;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text(citation.sourceText, 64, y, { width: 360 });
  doc.font('Helvetica-Bold').fontSize(22).fillColor(statusColor(citation.status)).text(`${citation.score}%`, 450, y - 10, { width: 70, align: 'right' });
  y += 34;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text).text('Assessment', 64, y);
  y += 16;
  doc.font('Helvetica').fontSize(10).text(citation.assessment, 64, y, { width: 460 });
  y += 28;

  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.muted).text('Criterion', 64, y);
  doc.text('Expected', 190, y);
  doc.text('Found', 320, y);
  doc.text('Status', 470, y);
  y += 16;

  citation.details.forEach((detail) => {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text).text(detail.criterion, 64, y, { width: 110 });
    doc.text(detail.expected, 190, y, { width: 110 });
    doc.text(detail.found, 320, y, { width: 130 });
    doc.fillColor(statusColor(detail.status)).text(detail.status.toUpperCase(), 470, y, { width: 50 });
    y += 18;
  });

  doc.y = top + cardHeight + 18;
}

function renderRecommendations(doc: PDFKit.PDFDocument, data: CitationReportData) {
  ensureSpace(doc, 140);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.text).text('Recommendations');
  doc.moveDown(0.5);

  data.recommendations.forEach((recommendation) => {
    ensureSpace(doc, 48);
    const top = doc.y;
    drawRoundedCard(doc, 50, top, 495, 36, COLORS.light);
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text(`• ${recommendation}`, 64, top + 11, { width: 460 });
    doc.y = top + 48;
  });
}

export async function renderCitationReportPdf(data: CitationReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Academic Misconduct Risk Assessment Report',
        Author: 'VeritasScan',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderHeader(doc, data);
    renderExecutiveSummary(doc, data);
    renderBreakdownTable(doc, data);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.text).text('Detailed Analysis');
    doc.moveDown(0.5);
    data.citations.forEach((citation, index) => renderCitationCard(doc, citation, index));
    renderRecommendations(doc, data);
    doc.end();
  });
}
