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

export function buildCitationReportPrompt(
  text: string,
  citationStyle: string,
  compliance: {
    requiredReferenceCount: number;
    actualReferenceCount: number;
    compliant2020Count: number;
    suspectedBookCount: number;
    suspectedNonAcademicCount: number;
  } = {
    requiredReferenceCount: 0,
    actualReferenceCount: 0,
    compliant2020Count: 0,
    suspectedBookCount: 0,
    suspectedNonAcademicCount: 0,
  },
): CitationReportPrompt {
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

Task compliance requirements:
- minimum required references: ${compliance.requiredReferenceCount}
- actual detected references: ${compliance.actualReferenceCount}
- references from 2020 onwards detected: ${compliance.compliant2020Count}
- suspected book sources: ${compliance.suspectedBookCount}
- suspected non-academic sources: ${compliance.suspectedNonAcademicCount}

Judge the essay against these requirements as well as the citation formatting quality.

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

const PAGE_LEFT = 50;
const CONTENT_WIDTH = 495;
const SECTION_GAP = 18;

function drawTextHeight(doc: PDFKit.PDFDocument, text: string, width: number, font = 'Helvetica', fontSize = 10) {
  return doc.font(font).fontSize(fontSize).heightOfString(text, { width, align: 'left' });
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  ensureSpace(doc, 28);
  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor(COLORS.text)
    .text(title, PAGE_LEFT, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.5);
}

function drawMetricCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, title: string, value: string, accent: string) {
  drawRoundedCard(doc, x, y, width, 72, COLORS.white);
  doc.save();
  doc.roundedRect(x, y, width, 72, 14).stroke(COLORS.border);
  doc.restore();
  doc.save();
  doc.roundedRect(x, y, width, 6, 6).fill(accent);
  doc.restore();
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(title, x + 14, y + 18, { width: width - 28 });
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(18).text(value, x + 14, y + 36, { width: width - 28 });
}

function renderHeader(doc: PDFKit.PDFDocument, data: CitationReportData) {
  doc.save();
  doc.rect(0, 0, doc.page.width, 92).fill(COLORS.navy);
  doc.restore();

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(20)
    .text('VeritasScan', PAGE_LEFT, 28, { width: 220 });

  doc
    .font('Helvetica')
    .fontSize(10)
    .text(data.reportId, doc.page.width - 190, 32, {
      width: 140,
      align: 'center',
    });

  doc.y = 116;
  doc
    .fillColor(COLORS.text)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('Academic Misconduct Risk Assessment Report', PAGE_LEFT, doc.y, {
      width: CONTENT_WIDTH,
    });
  doc.moveDown(0.2);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text(`Report generated on ${data.generatedAt}`, PAGE_LEFT, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.15);
  doc.text(`Essay title: ${data.essayTitle}`, PAGE_LEFT, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.15);
  doc.text(`Citation style reviewed: ${data.citationStyle}`, PAGE_LEFT, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(1);
}

function renderExecutiveSummary(doc: PDFKit.PDFDocument, data: CitationReportData) {
  const findingsHeight = data.keyFindings
    .slice(0, 4)
    .reduce((sum, finding) => sum + drawTextHeight(doc, `• ${finding}`, 220, 'Helvetica', 10) + 6, 0);
  const cardHeight = Math.max(190, 112 + findingsHeight);
  ensureSpace(doc, cardHeight + 8);
  const top = doc.y;

  drawRoundedCard(doc, PAGE_LEFT, top, CONTENT_WIDTH, cardHeight, COLORS.softBlue);
  doc.save();
  doc.roundedRect(PAGE_LEFT, top, CONTENT_WIDTH, cardHeight, 14).stroke(COLORS.border);
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(COLORS.text)
    .text('Executive Summary', PAGE_LEFT + 20, top + 18);

  drawMetricCard(doc, PAGE_LEFT + 20, top + 52, 120, 'Overall score', `${data.overallScore}%`, COLORS.indigo);
  drawMetricCard(doc, PAGE_LEFT + 156, top + 52, 120, 'Total citations', String(data.totalCitations), COLORS.success);
  drawMetricCard(doc, PAGE_LEFT + 292, top + 52, 120, 'Reliability', data.reliabilityLabel, statusColor(data.reliabilityLabel.toLowerCase() as CitationStatus));

  let findingsY = top + 52;
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.text)
    .text('Key findings', PAGE_LEFT + 430, findingsY, { width: 95 });
  findingsY += 20;

  for (const finding of data.keyFindings.slice(0, 4)) {
    const bullet = `• ${finding}`;
    const height = drawTextHeight(doc, bullet, 95, 'Helvetica', 9);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.text)
      .text(bullet, PAGE_LEFT + 430, findingsY, { width: 95 });
    findingsY += height + 6;
  }

  doc.y = top + cardHeight + SECTION_GAP;
}

function renderBreakdownTable(doc: PDFKit.PDFDocument, data: CitationReportData) {
  drawSectionTitle(doc, 'Validation Overview');

  const startX = PAGE_LEFT;
  const widths = [205, 50, 72, 96, 72];
  const headers = ['Category', 'Count', 'Percentage', 'Visual Bar', 'Status'];

  const renderHeaderRow = () => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.muted);
    let x = startX;
    headers.forEach((header, index) => {
      doc.text(header, x, doc.y, { width: widths[index] });
      x += widths[index];
    });
    doc.moveDown(0.6);
  };

  renderHeaderRow();

  data.breakdown.forEach((row, index) => {
    const rowHeight = 26;
    ensureSpace(doc, rowHeight + 6);
    const y = doc.y;

    if (index % 2 === 0) {
      drawRoundedCard(doc, startX, y - 2, CONTENT_WIDTH, rowHeight, COLORS.light);
    }

    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
    doc.text(row.label, startX + 10, y + 6, { width: widths[0] - 10 });
    doc.text(String(row.count), startX + widths[0], y + 6, { width: widths[1] });
    doc.text(`${row.percentage}%`, startX + widths[0] + widths[1], y + 6, { width: widths[2] });

    const barX = startX + widths[0] + widths[1] + widths[2];
    doc.save();
    doc.roundedRect(barX, y + 12, 80, 8, 4).fill('#E5EAF6');
    doc.roundedRect(barX, y + 12, Math.max(4, row.percentage * 0.8), 8, 4).fill(statusColor(row.status));
    doc.restore();

    doc
      .fillColor(statusColor(row.status))
      .font('Helvetica-Bold')
      .text(row.status.toUpperCase(), startX + widths[0] + widths[1] + widths[2] + widths[3], y + 6, {
        width: widths[4],
      });

    doc.y = y + rowHeight + 4;
  });

  doc.moveDown(0.8);
}

function renderLabeledBox(doc: PDFKit.PDFDocument, label: string, text: string, options: { fillColor?: string; borderColor?: string } = {}) {
  const height = 16 + drawTextHeight(doc, text, CONTENT_WIDTH - 32, 'Helvetica', 10) + 18;
  ensureSpace(doc, height + 4);
  const top = doc.y;
  drawRoundedCard(doc, PAGE_LEFT, top, CONTENT_WIDTH, height, options.fillColor || COLORS.white);
  doc.save();
  doc.roundedRect(PAGE_LEFT, top, CONTENT_WIDTH, height, 12).stroke(options.borderColor || COLORS.border);
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.muted).text(label, PAGE_LEFT + 16, top + 12, { width: CONTENT_WIDTH - 32 });
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text(text, PAGE_LEFT + 16, top + 30, { width: CONTENT_WIDTH - 32 });
  doc.y = top + height + 8;
}

function renderCitationDetailTable(doc: PDFKit.PDFDocument, details: CitationDetail[]) {
  const columnWidths = [110, 110, 165, 70];
  const startX = PAGE_LEFT;

  const renderTableHeader = () => {
    ensureSpace(doc, 24);
    const top = doc.y;
    drawRoundedCard(doc, startX, top, CONTENT_WIDTH, 24, COLORS.light);
    const headers = ['Criterion', 'Expected', 'Found', 'Status'];
    let x = startX + 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted);
    headers.forEach((header, index) => {
      doc.text(header, x, top + 8, { width: columnWidths[index] - 10 });
      x += columnWidths[index];
    });
    doc.y = top + 30;
  };

  renderTableHeader();

  details.forEach((detail) => {
    const cells = [
      detail.criterion,
      detail.expected,
      detail.found,
      detail.status.toUpperCase(),
    ];
    const rowHeight = Math.max(
      22,
      ...cells.map((cell, index) => drawTextHeight(
        doc,
        cell,
        columnWidths[index] - 12,
        index === 3 ? 'Helvetica-Bold' : 'Helvetica',
        9,
      ) + 12),
    );

    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      renderTableHeader();
    }

    const top = doc.y;
    doc.save();
    doc.roundedRect(startX, top, CONTENT_WIDTH, rowHeight, 8).fill(COLORS.white).stroke(COLORS.border);
    doc.restore();

    let x = startX + 10;
    cells.forEach((cell, index) => {
      doc
        .font(index === 3 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9)
        .fillColor(index === 3 ? statusColor(detail.status) : COLORS.text)
        .text(cell, x, top + 6, { width: columnWidths[index] - 12 });
      x += columnWidths[index];
    });

    doc.y = top + rowHeight + 6;
  });
}

function renderCitationSection(doc: PDFKit.PDFDocument, citation: CitationEntry, index: number) {
  ensureSpace(doc, 48);
  const headerTop = doc.y;
  drawRoundedCard(doc, PAGE_LEFT, headerTop, CONTENT_WIDTH, 32, COLORS.indigo);
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.white)
    .text(`Citation ${index + 1}: ${citation.citationLabel}`, PAGE_LEFT + 16, headerTop + 10, {
      width: 350,
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(COLORS.white)
    .text(`${citation.score}%`, PAGE_LEFT + 400, headerTop + 8, {
      width: 70,
      align: 'right',
    });
  doc.y = headerTop + 42;

  renderLabeledBox(doc, 'Source text', citation.sourceText, { fillColor: COLORS.white });
  renderLabeledBox(doc, 'Assessment', citation.assessment, { fillColor: COLORS.softBlue });
  renderCitationDetailTable(doc, citation.details);
  doc.moveDown(0.6);
}

function renderRecommendations(doc: PDFKit.PDFDocument, data: CitationReportData) {
  drawSectionTitle(doc, 'Recommendations');

  data.recommendations.forEach((recommendation) => {
    const height = 16 + drawTextHeight(doc, `• ${recommendation}`, CONTENT_WIDTH - 32, 'Helvetica', 10) + 16;
    ensureSpace(doc, height + 4);
    const top = doc.y;
    drawRoundedCard(doc, PAGE_LEFT, top, CONTENT_WIDTH, height, COLORS.light);
    doc.save();
    doc.roundedRect(PAGE_LEFT, top, CONTENT_WIDTH, height, 12).stroke(COLORS.border);
    doc.restore();
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(`• ${recommendation}`, PAGE_LEFT + 16, top + 12, { width: CONTENT_WIDTH - 32 });
    doc.y = top + height + 8;
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
    drawSectionTitle(doc, 'Detailed Analysis');
    data.citations.forEach((citation, index) => renderCitationSection(doc, citation, index));
    renderRecommendations(doc, data);
    doc.end();
  });
}
