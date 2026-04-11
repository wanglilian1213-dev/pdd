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

IMPORTANT: Do NOT check or score citation formatting quality (e.g. APA/Harvard visual presentation, italics, hanging indent, punctuation style). Only validate: author accuracy, year, title, journal/source, DOI availability, and relevance. Do NOT include any "formatting quality" criterion in the details array.

Return JSON in this shape:
{
  "overall_score": number (0-100 integer percentage, where 100 = perfect),
  "total_citations": number,
  "key_findings": ["string"],
  "citations": [
    {
      "citation_label": "string",
      "source_text": "string",
      "score": number (0-100 integer percentage, where 100 = perfect),
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

Judge the essay against these requirements. Do NOT judge citation formatting quality — only validate factual accuracy, source existence, and relevance.

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
    const rawScore = Number(citation.score ?? 0);
    // Model may return decimal (0-1) instead of percentage (0-100); normalise.
    const score = clampScore(rawScore > 0 && rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore));
    const details = Array.isArray(citation.details) ? citation.details as Array<Record<string, unknown>> : [];
    // Filter out any formatting-related criteria the model may still return
    const FORMATTING_KEYWORDS = /\bformat/i;
    const filteredDetails = details.filter((detail) => !FORMATTING_KEYWORDS.test(String(detail.criterion ?? '')));
    const normalizedDetails: CitationDetail[] = filteredDetails.length > 0
      ? filteredDetails.map((detail) => ({
          criterion: String(detail.criterion ?? 'Criterion'),
          expected: String(detail.expected ?? 'Not specified'),
          found: String(detail.found ?? 'Not specified'),
          status: normalizeCriterionStatus(detail.status),
        }))
      : [{
          criterion: 'Source verification',
          expected: 'Verifiable academic source',
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

  // Use actual parsed count — Claude's reported total_citations may not match.
  const totalCitations = citations.length;
  const rawOverall = Number(parsed?.overall_score ?? 0);
  const computedOverall = rawOverall > 0
    ? (rawOverall > 0 && rawOverall <= 1 ? Math.round(rawOverall * 100) : Math.round(rawOverall))
    : (citations.length > 0
      ? Math.round(citations.reduce((sum, citation) => sum + citation.score, 0) / citations.length)
      : 0);
  const overallScore = clampScore(computedOverall);
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
    const denominator = citations.length > 0 ? citations.length : 1;
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
  navy: '#2B5797',
  navyDark: '#1E3F6F',
  indigo: '#667EEA',
  accent: '#764BA2',
  gold: '#CFA74E',
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

function renderCoverPage(doc: PDFKit.PDFDocument) {
  const pw = doc.page.width;
  const ph = doc.page.height;

  // Full-page deep blue background
  doc.rect(0, 0, pw, ph).fill('#2B5797');

  const brandX = 50;

  // "Veritas" — V in gold, rest in white (Times-Bold approximates Georgia Bold)
  doc.font('Times-Bold').fontSize(39);
  doc.fillColor('#CFA74E').text('V', brandX, 70, { continued: true });
  doc.fillColor('#FFFFFF').text('eritas', { continued: false });

  // "Scan" — S in gold, rest in white
  doc.font('Times-Bold').fontSize(48);
  doc.fillColor('#CFA74E').text('S', brandX, 120, { continued: true });
  doc.fillColor('#FFFFFF').text('can', { continued: false });

  // White separator line
  const lineY = 195;
  doc.save();
  doc.moveTo(brandX, lineY).lineTo(pw - 50, lineY).strokeColor('#FFFFFF').lineWidth(0.8).stroke();
  doc.restore();

  // Main title
  doc.font('Times-Bold').fontSize(26).fillColor('#FFFFFF');
  doc.text('Academic Misconduct', brandX, 260);
  doc.text('Risk Assessment', brandX, 298);

  // Bottom-left: "Report  Version 1.2"
  // Use lineBreak:false to prevent auto page-break near page bottom
  const bottomY = ph - 65;
  doc.font('Helvetica').fontSize(12).fillColor('#FFFFFF');
  doc.text('Report  Version 1.2', 30, bottomY, { lineBreak: false });

  // Bottom-right: confidentiality notice
  doc.font('Helvetica').fontSize(8.6).fillColor('#FFFFFF');
  doc.text('Confidential ©VeritasScan.', 310, bottomY, { lineBreak: false });
  doc.text('All rights reserved.', 310, bottomY + 12, { lineBreak: false });

  // New page for report content
  doc.addPage();
}

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
  doc.roundedRect(x, y, width, 72, 8).stroke(COLORS.border);
  doc.restore();
  // Thin accent strip at top — clip to card bounds so it doesn't bleed
  doc.save();
  doc.roundedRect(x, y, width, 72, 8).clip();
  doc.rect(x, y, width, 4).fill(accent);
  doc.restore();
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(title, x + 14, y + 16, { width: width - 28, lineBreak: false });
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(18).text(value, x + 14, y + 34, { width: width - 28, lineBreak: false });
}

function renderHeader(doc: PDFKit.PDFDocument, data: CitationReportData) {
  const headerHeight = 92;
  const pw = doc.page.width;

  // Simulated gradient: two horizontal bands blending navy → indigo
  doc.save();
  doc.rect(0, 0, pw, headerHeight * 0.6).fill(COLORS.navy);
  doc.rect(0, headerHeight * 0.6, pw, headerHeight * 0.4).fill(COLORS.navyDark);
  doc.restore();

  // Thin gold accent line at bottom of header
  doc.save();
  doc.moveTo(0, headerHeight).lineTo(pw, headerHeight).strokeColor(COLORS.gold).lineWidth(2).stroke();
  doc.restore();

  // Brand name with gold V
  doc.font('Times-Bold').fontSize(20);
  doc.fillColor(COLORS.gold).text('V', PAGE_LEFT, 28, { continued: true });
  doc.fillColor(COLORS.white).text('eritasScan', { continued: false });

  // Report ID pill (PDFKit doesn't support rgba — use opacity API)
  const pillX = pw - 200;
  const pillW = 150;
  doc.save();
  doc.opacity(0.2).roundedRect(pillX, 26, pillW, 28, 14).fill(COLORS.white);
  doc.restore();
  doc.save();
  doc.opacity(0.35).roundedRect(pillX, 26, pillW, 28, 14).strokeColor(COLORS.white).lineWidth(0.5).stroke();
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.white)
    .text(data.reportId, pillX, 34, { width: pillW, align: 'center' });

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
  // Vertical stacked layout: title → metric cards → key findings
  const innerPad = 20;
  const innerWidth = CONTENT_WIDTH - innerPad * 2;
  const cardW = Math.floor((innerWidth - 20) / 3); // 3 cards with 10px gaps

  // Pre-calculate findings height for overall card sizing
  const findingsTextWidth = innerWidth;
  const findingsHeight = data.keyFindings
    .slice(0, 4)
    .reduce((sum, f) => sum + drawTextHeight(doc, `• ${f}`, findingsTextWidth, 'Helvetica', 9.5) + 4, 0);

  // Total card: title(36) + metric cards(80) + gap(12) + findings title(18) + findings + bottom pad
  const totalHeight = 36 + 80 + 12 + 18 + findingsHeight + 16;
  ensureSpace(doc, totalHeight + 8);
  const top = doc.y;

  // Outer card
  drawRoundedCard(doc, PAGE_LEFT, top, CONTENT_WIDTH, totalHeight, COLORS.softBlue);
  doc.save();
  doc.roundedRect(PAGE_LEFT, top, CONTENT_WIDTH, totalHeight, 12).stroke(COLORS.border);
  doc.restore();

  // Title
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.text)
    .text('Executive Summary', PAGE_LEFT + innerPad, top + 14, { lineBreak: false });

  // Metric cards — evenly spaced
  const metricsY = top + 40;
  const cardStartX = PAGE_LEFT + innerPad;
  drawMetricCard(doc, cardStartX, metricsY, cardW, 'Overall score', `${data.overallScore}%`, COLORS.indigo);
  drawMetricCard(doc, cardStartX + cardW + 10, metricsY, cardW, 'Total citations', String(data.totalCitations), COLORS.success);
  drawMetricCard(doc, cardStartX + (cardW + 10) * 2, metricsY, cardW, 'Reliability', data.reliabilityLabel, statusColor(data.reliabilityLabel.toLowerCase() as CitationStatus));

  // Key findings — full width below the cards
  let findingsY = metricsY + 80 + 12;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text)
    .text('Key findings', PAGE_LEFT + innerPad, findingsY, { width: findingsTextWidth, lineBreak: false });
  findingsY += 18;

  for (const finding of data.keyFindings.slice(0, 4)) {
    const bullet = `• ${finding}`;
    const h = drawTextHeight(doc, bullet, findingsTextWidth, 'Helvetica', 9.5);
    doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text)
      .text(bullet, PAGE_LEFT + innerPad, findingsY, { width: findingsTextWidth });
    findingsY += h + 4;
  }

  doc.y = top + totalHeight + SECTION_GAP;
}

function renderBreakdownTable(doc: PDFKit.PDFDocument, data: CitationReportData) {
  drawSectionTitle(doc, 'Validation Overview');

  const startX = PAGE_LEFT;
  const widths = [180, 45, 60, 96, 114];
  const headers = ['Category', 'Count', 'Percentage', 'Visual Bar', 'Status'];

  const renderHeaderRow = () => {
    const headerY = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.muted);
    let x = startX;
    headers.forEach((header, index) => {
      doc.text(header, x, headerY, { width: widths[index], lineBreak: false });
      x += widths[index];
    });
    doc.y = headerY + 16;
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
    const top = doc.y;
    drawRoundedCard(doc, startX, top, CONTENT_WIDTH, 24, COLORS.light);
    const headers = ['Criterion', 'Expected', 'Found', 'Status'];
    const headerY = top + 8;
    let x = startX + 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted);
    headers.forEach((header, index) => {
      doc.text(header, x, headerY, { width: columnWidths[index] - 10, lineBreak: false });
      x += columnWidths[index];
    });
    doc.y = top + 30;
  };

  // Reserve space for header (30) + at least one data row (28) together
  // to prevent orphaned table headers at page bottom
  ensureSpace(doc, 58);
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
  drawRoundedCard(doc, PAGE_LEFT, headerTop, CONTENT_WIDTH, 32, COLORS.navy);
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

function getVerdictText(score: number): string {
  if (score >= 90) {
    return 'All references in this essay have been verified as credible academic sources. The citation quality meets or exceeds expectations for scholarly work. No integrity concerns were identified during this assessment.';
  }
  if (score >= 70) {
    return 'The majority of references in this essay are verified academic sources. A small number of citations could not be fully confirmed but do not raise significant integrity concerns. Overall citation quality is satisfactory for scholarly work.';
  }
  if (score >= 50) {
    return 'Several references in this essay could not be fully verified or present minor quality concerns. While no definitive integrity violations were detected, the citation base would benefit from additional peer-reviewed sources to strengthen academic rigor.';
  }
  return 'A significant portion of references in this essay could not be verified or present quality concerns. The citation base may not meet the expected standard for scholarly work. Further review and source strengthening is recommended.';
}

function renderConclusion(doc: PDFKit.PDFDocument, data: CitationReportData) {
  const verdictText = getVerdictText(data.overallScore);
  const textHeight = drawTextHeight(doc, verdictText, CONTENT_WIDTH - 80, 'Helvetica', 10);
  // Card: title(20) + pad(16) + score circle area(80) + gap(12) + text + bottom pad(20)
  const cardHeight = 20 + 16 + 80 + 12 + textHeight + 24;
  ensureSpace(doc, cardHeight + 20);

  drawSectionTitle(doc, 'Conclusion');
  const top = doc.y;

  // Outer card with navy left accent border
  drawRoundedCard(doc, PAGE_LEFT, top, CONTENT_WIDTH, cardHeight, COLORS.softBlue);
  doc.save();
  doc.roundedRect(PAGE_LEFT, top, CONTENT_WIDTH, cardHeight, 12).stroke(COLORS.border);
  doc.restore();
  // Left accent strip
  doc.save();
  doc.roundedRect(PAGE_LEFT, top, CONTENT_WIDTH, cardHeight, 12).clip();
  doc.rect(PAGE_LEFT, top, 5, cardHeight).fill(COLORS.navy);
  doc.restore();

  // "Overall Verdict" label
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.text)
    .text('Overall Verdict', PAGE_LEFT + 24, top + 16, { width: CONTENT_WIDTH - 48, lineBreak: false });

  // Score circle — centered
  const circleX = PAGE_LEFT + CONTENT_WIDTH / 2;
  const circleY = top + 16 + 24 + 40; // center of 80px area
  const radius = 34;
  const scoreColor = statusColor(getStatusFromScore(data.overallScore));

  // Outer ring
  doc.save();
  doc.circle(circleX, circleY, radius).lineWidth(5).strokeColor(scoreColor).stroke();
  doc.restore();
  // Inner fill (light)
  doc.save();
  doc.circle(circleX, circleY, radius - 4).fill(COLORS.white);
  doc.restore();
  // Score number
  doc.font('Helvetica-Bold').fontSize(22).fillColor(scoreColor)
    .text(`${data.overallScore}%`, circleX - 30, circleY - 12, { width: 60, align: 'center' });
  // Label below score
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted)
    .text(data.reliabilityLabel.toUpperCase(), circleX - 40, circleY + 14, { width: 80, align: 'center' });

  // Summary text below circle
  const textY = top + 16 + 24 + 80 + 12;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text)
    .text(verdictText, PAGE_LEFT + 24, textY, { width: CONTENT_WIDTH - 48 });

  doc.y = top + cardHeight + SECTION_GAP;
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

    renderCoverPage(doc);
    renderHeader(doc, data);
    renderExecutiveSummary(doc, data);
    renderBreakdownTable(doc, data);
    drawSectionTitle(doc, 'Detailed Analysis');
    data.citations.forEach((citation, index) => renderCitationSection(doc, citation, index));
    renderConclusion(doc, data);
    doc.end();
  });
}
