import PDFDocument from 'pdfkit';
import type {
  ScoringResult,
  ScoringScenario,
  ScoringDimension,
} from './scoringPromptService';

// ---------------------------------------------------------------------------
// 评审 PDF 报告渲染
// ---------------------------------------------------------------------------
//
// 输入：executeScoring 已经校验通过的 ScoringResult + 场景 + 正式题目（可选）
// 输出：Buffer（application/pdf），由上层上传到 Supabase Storage
//
// 设计原则：
// 1) 复用现有引用核验报告 pdfkit 封装的模式：Times-Roman 12pt，按真实内容自动分页，
//    不写死卡片高度避免文字溢出 / 压线。
// 2) 所有动态高度都用 heightOfString 提前量好，再调 ensureSpace 确认当页够用，不够就 addPage。
// 3) 中文会 fallback 到 Helvetica（pdfkit 不内置 CJK 字体，再叠 Times-Roman 仍会渲染成方块）；
//    评分报告的文本大部分是英文 + 用户论文中的引用短语，暂不接字体嵌入，后续要中文时再加。
// ---------------------------------------------------------------------------

export interface ScoringReportData {
  result: ScoringResult;
  scenario: ScoringScenario;
  /** 正式题目/文章名，取自 detected_files 里 role='article' 的 filename（已剥扩展名）。 */
  articleTitle: string | null;
  /** 生成时间戳，用于报告落款。 */
  generatedAt: Date;
}

const PAGE_MARGIN = 54;          // 0.75 inch
const BODY_FONT_SIZE = 12;
const HEADING_FONT_SIZE = 16;
const SUBHEADING_FONT_SIZE = 13;
const LINE_GAP = 4;
const CARD_PADDING = 12;
const SECTION_GAP = 18;

const SCENARIO_LABEL: Record<ScoringScenario, string> = {
  rubric: 'Graded strictly against the uploaded rubric',
  brief_only: 'Graded against the five default dimensions, weighted by the brief',
  article_only: 'Graded against the five default dimensions (30/25/20/15/10)',
};

export function buildScoringReportData(
  result: ScoringResult,
  scenario: ScoringScenario,
  articleTitle: string | null,
): ScoringReportData {
  return {
    result,
    scenario,
    articleTitle,
    generatedAt: new Date(),
  };
}

/**
 * 渲染评审 PDF 报告为 Buffer。
 * 失败时直接抛（上层 executeScoring 会 catch 进 refund 分支）。
 */
export function renderScoringReportPdf(data: ScoringReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: PAGE_MARGIN,
        info: {
          Title: data.articleTitle
            ? `Scoring Report — ${data.articleTitle}`
            : 'Scoring Report',
          Author: '拼代代 Academic Scoring',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: Error) => reject(err));

      renderReport(doc, data);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// 绘制主流程
// ---------------------------------------------------------------------------

function renderReport(doc: any, data: ScoringReportData) {
  renderHeader(doc, data);
  renderOverallSection(doc, data);
  renderDimensionsSection(doc, data.result.dimensions);
  renderTopSuggestionsSection(doc, data.result.top_suggestions);
  renderDetectedFilesSection(doc, data.result.detected_files);
  renderFooter(doc, data);
}

function renderHeader(doc: any, data: ScoringReportData) {
  doc
    .font('Times-Bold')
    .fontSize(HEADING_FONT_SIZE)
    .text('Academic Scoring Report', { align: 'left' });

  if (data.articleTitle) {
    doc
      .font('Times-Italic')
      .fontSize(BODY_FONT_SIZE)
      .text(data.articleTitle, { align: 'left' });
  }

  doc
    .font('Times-Roman')
    .fontSize(BODY_FONT_SIZE - 1)
    .fillColor('#555')
    .text(SCENARIO_LABEL[data.scenario], { align: 'left' })
    .fillColor('#000');

  doc.moveDown(0.8);
  drawHorizontalRule(doc);
  doc.moveDown(0.6);
}

function renderOverallSection(doc: any, data: ScoringReportData) {
  drawSectionTitle(doc, 'Overall');

  // Big score badge (just bold text, keep layout simple — no card background yet)
  doc
    .font('Times-Bold')
    .fontSize(36)
    .text(`${data.result.overall_score} / 100`, { align: 'left' });

  doc.moveDown(0.3);

  doc
    .font('Times-Roman')
    .fontSize(BODY_FONT_SIZE)
    .text(data.result.overall_comment, {
      align: 'left',
      lineGap: LINE_GAP,
    });

  doc.moveDown(SECTION_GAP / BODY_FONT_SIZE);
}

function renderDimensionsSection(doc: any, dimensions: ScoringDimension[]) {
  drawSectionTitle(doc, 'Dimension Breakdown');

  dimensions.forEach((dim, idx) => {
    renderDimensionCard(doc, dim, idx + 1);
    doc.moveDown(0.4);
  });

  doc.moveDown(SECTION_GAP / BODY_FONT_SIZE);
}

function renderDimensionCard(doc: any, dim: ScoringDimension, index: number) {
  const headerText = `${index}. ${dim.name} — ${dim.weight}% weight, score ${dim.score}/100`;

  ensureSpace(doc, estimateDimensionHeight(doc, dim));

  doc
    .font('Times-Bold')
    .fontSize(SUBHEADING_FONT_SIZE)
    .text(headerText, { align: 'left' });

  doc.moveDown(0.2);

  renderBulletGroup(doc, 'Strengths', dim.strengths);
  renderBulletGroup(doc, 'Weaknesses', dim.weaknesses);
  renderBulletGroup(doc, 'Suggestions', dim.suggestions);
}

function renderTopSuggestionsSection(doc: any, suggestions: string[]) {
  drawSectionTitle(doc, 'Top Suggestions');

  suggestions.forEach((s, idx) => {
    const line = `${idx + 1}. ${s}`;
    ensureSpace(doc, doc.heightOfString(line, { width: contentWidth(doc) }) + LINE_GAP);
    doc
      .font('Times-Roman')
      .fontSize(BODY_FONT_SIZE)
      .text(line, { align: 'left', lineGap: LINE_GAP });
  });

  doc.moveDown(SECTION_GAP / BODY_FONT_SIZE);
}

function renderDetectedFilesSection(
  doc: any,
  detected: ScoringResult['detected_files'],
) {
  drawSectionTitle(doc, 'Detected Files');

  detected.forEach((f) => {
    const base = `• ${f.filename} — ${f.role}`;
    const line = f.note && f.note.trim() ? `${base}（${f.note}）` : base;
    ensureSpace(doc, doc.heightOfString(line, { width: contentWidth(doc) }) + LINE_GAP);
    doc
      .font('Times-Roman')
      .fontSize(BODY_FONT_SIZE)
      .text(line, { align: 'left', lineGap: LINE_GAP });
  });

  doc.moveDown(SECTION_GAP / BODY_FONT_SIZE);
}

function renderFooter(doc: any, data: ScoringReportData) {
  drawHorizontalRule(doc);
  doc.moveDown(0.4);

  const dateStr = data.generatedAt.toISOString().slice(0, 10);
  doc
    .font('Times-Italic')
    .fontSize(BODY_FONT_SIZE - 2)
    .fillColor('#555')
    .text(
      `Generated ${dateStr} by 拼代代 Academic Scoring. This report simulates how a qualified mentor would grade the submission and is intended for self-assessment before formal submission.`,
      { align: 'left' },
    )
    .fillColor('#000');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function contentWidth(doc: any): number {
  return doc.page.width - PAGE_MARGIN * 2;
}

function drawHorizontalRule(doc: any) {
  const y = doc.y;
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .strokeColor('#ccc')
    .lineWidth(0.5)
    .stroke()
    .strokeColor('#000')
    .lineWidth(1);
}

function drawSectionTitle(doc: any, title: string) {
  ensureSpace(doc, SUBHEADING_FONT_SIZE + SECTION_GAP);
  doc
    .font('Times-Bold')
    .fontSize(SUBHEADING_FONT_SIZE)
    .text(title, { align: 'left' });
  doc.moveDown(0.3);
}

function renderBulletGroup(doc: any, label: string, items: string[]) {
  if (!items || items.length === 0) return;

  doc
    .font('Times-Bold')
    .fontSize(BODY_FONT_SIZE)
    .text(`${label}:`, { align: 'left' });

  items.forEach((item) => {
    const bullet = `• ${item}`;
    ensureSpace(doc, doc.heightOfString(bullet, { width: contentWidth(doc) - CARD_PADDING }) + LINE_GAP);
    doc
      .font('Times-Roman')
      .fontSize(BODY_FONT_SIZE)
      .text(bullet, {
        align: 'left',
        lineGap: LINE_GAP,
        indent: CARD_PADDING,
      });
  });

  doc.moveDown(0.2);
}

function ensureSpace(doc: any, needed: number) {
  const bottom = doc.page.height - PAGE_MARGIN;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

function estimateDimensionHeight(doc: any, dim: ScoringDimension): number {
  // Rough estimate: header + 3 labels + all bullets. pdfkit auto-wraps anyway;
  // we only use this to decide "should we page break before starting the card".
  const width = contentWidth(doc);
  let total = SUBHEADING_FONT_SIZE + 6;
  const countBullets = (items: string[]) =>
    items.reduce(
      (acc, item) => acc + doc.heightOfString(`• ${item}`, { width }) + LINE_GAP,
      0,
    );
  total += BODY_FONT_SIZE + 2 + countBullets(dim.strengths);
  total += BODY_FONT_SIZE + 2 + countBullets(dim.weaknesses);
  total += BODY_FONT_SIZE + 2 + countBullets(dim.suggestions);
  return total;
}
