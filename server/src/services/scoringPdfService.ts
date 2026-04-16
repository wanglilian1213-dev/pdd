import path from 'path';
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
// 1) 固定文案（标题 / 章节名 / 标签）统一用中文，配合 GPT 输出的中文反馈。
// 2) pdfkit 内置 Times-Roman / Helvetica 不含中文字形，必须注册 CJK 字体
//    （Source Han Sans CN Regular）用于所有渲染，英文数字也兼容。
// 3) 字体文件位于 server/fonts/ 目录，git 追踪，Railway 部署会带过去。
// 4) 按真实内容自动分页，用 heightOfString + ensureSpace 提前量好空间。
// ---------------------------------------------------------------------------

// 字体文件路径：__dirname 在编译后是 dist/services/，向上两级到 server/ 根，再进 fonts/
const CJK_FONT_PATH = path.join(__dirname, '..', '..', 'fonts', 'SourceHanSansCN-Regular.otf');
const CJK_FONT = 'CJK';

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
  rubric: '按上传的评分标准 (Rubric) 严格评审',
  brief_only: '按默认五维度评审，权重参照任务要求 (Brief) 微调',
  article_only: '仅文章，按默认五维度评审（30/25/20/15/10）',
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
            ? `评审报告 — ${data.articleTitle}`
            : '评审报告',
          Author: '拼代代 Academic Scoring',
        },
      });

      // 注册 CJK 字体（所有 .font(CJK_FONT) 调用统一走这一个字体）
      doc.registerFont(CJK_FONT, CJK_FONT_PATH);

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
    .font(CJK_FONT)
    .fontSize(HEADING_FONT_SIZE)
    .text('学术评审报告', { align: 'left' });

  if (data.articleTitle) {
    doc
      .font(CJK_FONT)
      .fontSize(BODY_FONT_SIZE)
      .fillColor('#333')
      .text(data.articleTitle, { align: 'left' })
      .fillColor('#000');
  }

  doc
    .font(CJK_FONT)
    .fontSize(BODY_FONT_SIZE - 1)
    .fillColor('#555')
    .text(SCENARIO_LABEL[data.scenario], { align: 'left' })
    .fillColor('#000');

  doc.moveDown(0.8);
  drawHorizontalRule(doc);
  doc.moveDown(0.6);
}

function renderOverallSection(doc: any, data: ScoringReportData) {
  drawSectionTitle(doc, '总体评价');

  // 大字总分
  doc
    .font(CJK_FONT)
    .fontSize(36)
    .text(`${data.result.overall_score} / 100`, { align: 'left' });

  doc.moveDown(0.3);

  doc
    .font(CJK_FONT)
    .fontSize(BODY_FONT_SIZE)
    .text(data.result.overall_comment, {
      align: 'left',
      lineGap: LINE_GAP,
    });

  doc.moveDown(SECTION_GAP / BODY_FONT_SIZE);
}

function renderDimensionsSection(doc: any, dimensions: ScoringDimension[]) {
  drawSectionTitle(doc, '分维度评分');

  dimensions.forEach((dim, idx) => {
    renderDimensionCard(doc, dim, idx + 1);
    doc.moveDown(0.4);
  });

  doc.moveDown(SECTION_GAP / BODY_FONT_SIZE);
}

function renderDimensionCard(doc: any, dim: ScoringDimension, index: number) {
  // 维度名保留 rubric 原文（通常英文），括号里附中文权重/分数说明
  const headerText = `${index}. ${dim.name}  （权重 ${dim.weight}% · 得分 ${dim.score}/100）`;

  ensureSpace(doc, estimateDimensionHeight(doc, dim));

  doc
    .font(CJK_FONT)
    .fontSize(SUBHEADING_FONT_SIZE)
    .text(headerText, { align: 'left' });

  doc.moveDown(0.2);

  renderBulletGroup(doc, '优点', dim.strengths);
  renderBulletGroup(doc, '不足', dim.weaknesses);
  renderBulletGroup(doc, '建议', dim.suggestions);
}

function renderTopSuggestionsSection(doc: any, suggestions: string[]) {
  drawSectionTitle(doc, '优先改进建议');

  suggestions.forEach((s, idx) => {
    const line = `${idx + 1}. ${s}`;
    ensureSpace(doc, doc.heightOfString(line, { width: contentWidth(doc) }) + LINE_GAP);
    doc
      .font(CJK_FONT)
      .fontSize(BODY_FONT_SIZE)
      .text(line, { align: 'left', lineGap: LINE_GAP });
  });

  doc.moveDown(SECTION_GAP / BODY_FONT_SIZE);
}

const ROLE_LABEL: Record<string, string> = {
  article: '待评审文章',
  rubric: '评分标准',
  brief: '任务要求',
  other: '其它材料',
};

function renderDetectedFilesSection(
  doc: any,
  detected: ScoringResult['detected_files'],
) {
  drawSectionTitle(doc, '识别到的材料');

  detected.forEach((f) => {
    const roleZh = ROLE_LABEL[f.role] || f.role;
    const base = `• ${f.filename} — ${roleZh}`;
    const line = f.note && f.note.trim() ? `${base}（${f.note}）` : base;
    ensureSpace(doc, doc.heightOfString(line, { width: contentWidth(doc) }) + LINE_GAP);
    doc
      .font(CJK_FONT)
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
    .font(CJK_FONT)
    .fontSize(BODY_FONT_SIZE - 2)
    .fillColor('#555')
    .text(
      `${dateStr} 由拼代代学术评审生成。本报告模拟合格导师的评审视角，仅供正式提交前的自查参考，不代表最终评分。`,
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
    .font(CJK_FONT)
    .fontSize(SUBHEADING_FONT_SIZE)
    .fillColor('#111')
    .text(title, { align: 'left' })
    .fillColor('#000');
  doc.moveDown(0.3);
}

function renderBulletGroup(doc: any, label: string, items: string[]) {
  if (!items || items.length === 0) return;

  doc
    .font(CJK_FONT)
    .fontSize(BODY_FONT_SIZE)
    .fillColor('#333')
    .text(`${label}：`, { align: 'left' })
    .fillColor('#000');

  items.forEach((item) => {
    const bullet = `• ${item}`;
    ensureSpace(doc, doc.heightOfString(bullet, { width: contentWidth(doc) - CARD_PADDING }) + LINE_GAP);
    doc
      .font(CJK_FONT)
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
  // Rough estimate: header + 3 labels + all bullets. pdfkit 自动换行，这里只是"下一页要不要新开"的预判。
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
