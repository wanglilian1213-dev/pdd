import {
  AlignmentType,
  Document,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { normalizeDeliveryPaperTitle } from './paperTitleService';
import type { RenderedChart } from './chartRenderService';

export type PaperParagraphKind =
  | 'cover_course_code'
  | 'cover_title'
  | 'heading'
  | 'body'
  | 'reference_heading'
  | 'reference'
  | 'table'
  | 'chart_image';

export interface PaperParagraphModel {
  kind: PaperParagraphKind;
  text: string;
  runs: PaperTextRunModel[];
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  alignment: 'left' | 'center';
  lineSpacing: number;
  hangingIndent: boolean;
  pageBreakBefore: boolean;
  /** 仅 kind === 'table' 时有意义：解析后的二维表格数据，第一行为表头 */
  tableRows?: string[][];
  /** 仅 kind === 'chart_image' 时有意义：用于到 mediaMap 里查 PNG buffer 的占位 token */
  chartToken?: string;
}

export interface PaperTextRunModel {
  text: string;
  bold: boolean;
  italics: boolean;
}

interface PaperLayoutModel {
  paragraphs: PaperParagraphModel[];
}

interface PaperLayoutOptions {
  paperTitle?: string | null;
  courseCode?: string | null;
  /**
   * 启用 markdown 表格 + chart 占位 token 的识别。
   * 仅 revisionService 走 `buildFormattedPaperDocBufferWithMedia` 路径时打开；
   * 其他服务（writingService / humanizeService / deliveryRepairService）保持 false，
   * 行为完全不变，避免论文里偶然出现的 `| ... |` 行被误识别成表格。
   */
  enableMedia?: boolean;
}

const FONT_FAMILY = 'Times New Roman';
const FONT_SIZE = 12;
const LINE_SPACING = 1.5;
const DOCX_FONT_SIZE = FONT_SIZE * 2;
const DOCX_LINE_SPACING = 360;
const HANGING_INDENT_TWIPS = 720;
const REFERENCE_HEADINGS = new Set(['references', 'reference list', 'bibliography', 'works cited']);

function stripLeadingMarkdownSyntax(value: string) {
  return value
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .trim();
}

function mergeRuns(runs: PaperTextRunModel[]) {
  const merged: PaperTextRunModel[] = [];

  for (const run of runs) {
    if (!run.text) {
      continue;
    }

    const previous = merged[merged.length - 1];
    if (previous && previous.bold === run.bold && previous.italics === run.italics) {
      previous.text += run.text;
      continue;
    }

    merged.push({ ...run });
  }

  return merged;
}

function parseInlineRuns(value: string): PaperTextRunModel[] {
  const source = stripLeadingMarkdownSyntax(value);
  const pattern = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`)/g;
  const runs: PaperTextRunModel[] = [];
  let lastIndex = 0;

  for (const match of source.matchAll(pattern)) {
    const matchText = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      runs.push({
        text: source.slice(lastIndex, index),
        bold: false,
        italics: false,
      });
    }

    const boldText = match[2] ?? match[3];
    const italicText = match[4] ?? match[5];
    const codeText = match[6];

    if (boldText) {
      runs.push({ text: boldText, bold: true, italics: false });
    } else if (italicText) {
      runs.push({ text: italicText, bold: false, italics: true });
    } else if (codeText) {
      runs.push({ text: codeText, bold: false, italics: false });
    } else if (matchText) {
      runs.push({ text: matchText, bold: false, italics: false });
    }

    lastIndex = index + matchText.length;
  }

  if (lastIndex < source.length) {
    runs.push({
      text: source.slice(lastIndex),
      bold: false,
      italics: false,
    });
  }

  return mergeRuns(runs.map((run) => ({
    ...run,
    text: run.text.replace(/\s+/g, ' '),
  }))).filter((run) => run.text.trim().length > 0 || run.text.includes(' '));
}

function cleanInlineFormatting(value: string) {
  return parseInlineRuns(value)
    .map((run) => run.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 切分文本为段落块。**保留原始行**（不剥离 `1. ` / `# ` / `- ` 等 markdown 前缀），
 * 这样表格 cell 里的编号（"1. 准备"）不会被悄悄吞掉。
 *
 * 下游使用约定：
 *  - 表格 / chart placeholder 检测必须用原始行
 *  - heading 检测和 body paragraph 构建必须先调 `stripBlockMarkers` 把前缀剥掉
 *    （`buildParagraph` 内部还会再走 `parseInlineRuns` → `stripLeadingMarkdownSyntax`，
 *    所以 body 路径其实可以省一次显式剥离，但显式更清晰）
 */
function splitIntoBlocks(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n\s*\n/)
    .map((block) => block
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))
      .filter((line) => line.trim().length > 0))
    .filter((lines) => lines.length > 0);
}

/** 把一个 raw block 的每一行剥掉 markdown 前缀。仅供 heading 检测/正文构建使用。 */
function stripBlockMarkers(rawBlock: string[]): string[] {
  return rawBlock
    .map((line) => stripLeadingMarkdownSyntax(line))
    .filter(Boolean);
}

function isReferenceHeading(text: string) {
  return REFERENCE_HEADINGS.has(text.trim().toLowerCase());
}

function isHeadingBlock(lines: string[]) {
  if (lines.length !== 1) {
    return false;
  }

  const text = lines[0]!.trim();
  if (!text || text.length > 80) {
    return false;
  }

  return (
    /^[IVXLC]+\.\s+/i.test(text) ||
    /^\d+(\.\d+)*\s+/.test(text) ||
    /^(introduction|background|literature review|analysis|discussion|conclusion|methodology|results|findings)$/i.test(text) ||
    /^[A-Z][A-Za-z\s/&-]+$/.test(text)
  );
}

function buildParagraph(kind: PaperParagraphKind, text: string): PaperParagraphModel {
  const runs = kind === 'cover_course_code' || kind === 'cover_title'
    ? [{ text: cleanInlineFormatting(text), bold: false, italics: false }]
    : parseInlineRuns(text);
  const trimmed = runs.map((run) => run.text).join('').replace(/\s+/g, ' ').trim();

  return {
    kind,
    text: trimmed,
    runs,
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    bold: kind === 'cover_title' || kind === 'heading' || kind === 'reference_heading',
    alignment: kind === 'cover_course_code' || kind === 'cover_title' ? 'center' : 'left',
    lineSpacing: LINE_SPACING,
    hangingIndent: kind === 'reference',
    pageBreakBefore: false,
  };
}

function extractReferenceParagraphs(blocks: string[][]) {
  const references: string[] = [];

  for (const block of blocks) {
    const lines = block
      .map((line) => stripLeadingMarkdownSyntax(line))
      .filter(Boolean);

    if (lines.length === 0) {
      continue;
    }

    let currentReference = '';
    for (const line of lines) {
      const plainLine = cleanInlineFormatting(line);
      const startsNewReference = /^[A-Z][A-Za-z'`.-]+(?:\s+[A-Z][A-Za-z'`.-]+)*,\s*[A-Z]/.test(plainLine);
      if (!currentReference) {
        currentReference = line;
        continue;
      }

      if (startsNewReference) {
        references.push(currentReference.replace(/\s+/g, ' ').trim());
        currentReference = line;
        continue;
      }

      currentReference = `${currentReference} ${line}`.replace(/\s+/g, ' ').trim();
    }

    if (currentReference) {
      references.push(currentReference.replace(/\s+/g, ' ').trim());
    }
  }

  return references;
}

function normalizeBlockText(lines: string[]) {
  return lines
    .map((line) => cleanInlineFormatting(stripLeadingMarkdownSyntax(line)))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitleForComparison(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function blockLooksLikeReference(lines: string[]) {
  const text = normalizeBlockText(lines);
  if (!text) {
    return false;
  }

  if (isReferenceHeading(text)) {
    return true;
  }

  if (/https?:\/\/|doi\.org|doi:/i.test(text)) {
    return true;
  }

  return /\b(19|20)\d{2}\b/.test(text) && /^[A-Z][A-Za-z'`.-]+(?:\s+[A-Z][A-Za-z'`.-]+)*,\s*[A-Z]/.test(text);
}

function inferReferenceStart(blocks: string[][]) {
  let firstReferenceIndex = -1;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (!blockLooksLikeReference(blocks[index]!)) {
      break;
    }

    firstReferenceIndex = index;
  }

  return firstReferenceIndex;
}

function findReferenceSections(blocks: string[][]) {
  const explicitHeadingIndex = blocks.findIndex((block) => isReferenceHeading(normalizeBlockText(block)));
  if (explicitHeadingIndex !== -1) {
    return {
      bodyBlocks: blocks.slice(0, explicitHeadingIndex),
      referenceHeading: normalizeBlockText(blocks[explicitHeadingIndex]!),
      referenceBlocks: blocks.slice(explicitHeadingIndex + 1),
    };
  }

  const inferredStart = inferReferenceStart(blocks);
  if (inferredStart === -1) {
    return {
      bodyBlocks: blocks,
      referenceHeading: null,
      referenceBlocks: [],
    };
  }

  return {
    bodyBlocks: blocks.slice(0, inferredStart),
    referenceHeading: 'References',
    referenceBlocks: blocks.slice(inferredStart),
  };
}

// ---------------------------------------------------------------------------
// Markdown table + chart placeholder support (enableMedia 路径专用)
// ---------------------------------------------------------------------------

const CHART_PLACEHOLDER_RE = /^\[\[CHART_PLACEHOLDER_(\d+)\]\]$/;
const TABLE_SEPARATOR_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;

function isChartPlaceholderBlock(lines: string[]): boolean {
  return lines.length === 1 && CHART_PLACEHOLDER_RE.test(lines[0]!.trim());
}

function isTableBlock(lines: string[]): boolean {
  if (lines.length < 2) return false;
  return TABLE_SEPARATOR_RE.test(lines[1]!.trim());
}

function parseTableBlock(lines: string[]): string[][] {
  // 跳过分隔行（第二行）
  const dataLines = lines.filter((_, idx) => idx !== 1);

  const rows = dataLines.map((line) => {
    // 处理 \| 转义：先临时替换为 NULL 字符，split 完再还原
    const escaped = line.replace(/\\\|/g, '\u0000');
    const parts = escaped.split('|').map((cell) => cell.replace(/\u0000/g, '|').trim());

    // 去除由首尾 `|` 分隔符产生的空 cell
    if (parts.length > 0 && parts[0] === '') parts.shift();
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();

    return parts;
  }).filter((row) => row.length > 0);

  if (rows.length === 0) return [];

  // 列数对齐：取最大列数，短行补空 cell
  const maxCols = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...Array(maxCols - row.length).fill('')]);
}

function buildTableParagraphModel(rows: string[][]): PaperParagraphModel {
  return {
    kind: 'table',
    text: '',
    runs: [],
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    bold: false,
    alignment: 'left',
    lineSpacing: LINE_SPACING,
    hangingIndent: false,
    pageBreakBefore: false,
    tableRows: rows,
  };
}

function buildChartImageParagraphModel(token: string): PaperParagraphModel {
  return {
    kind: 'chart_image',
    text: token,
    runs: [],
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    bold: false,
    alignment: 'center',
    lineSpacing: LINE_SPACING,
    hangingIndent: false,
    pageBreakBefore: false,
    chartToken: token,
  };
}

export function buildPaperLayoutModel(text: string, options: PaperLayoutOptions = {}): PaperLayoutModel {
  const blocks = splitIntoBlocks(text);
  const paragraphs: PaperParagraphModel[] = [];
  const inferredTitle = options.paperTitle || normalizeBlockText(blocks[0] || ['Untitled Paper']);
  const paperTitle = normalizeDeliveryPaperTitle(cleanInlineFormatting(inferredTitle), 'Untitled Paper');
  const courseCode = cleanInlineFormatting(options.courseCode || '');

  paragraphs.push(buildParagraph('cover_course_code', courseCode));
  paragraphs.push(buildParagraph('cover_title', paperTitle));

  if (blocks.length === 0) {
    return { paragraphs };
  }

  const normalizedTitleBlock = normalizeTitleForComparison(normalizeBlockText(blocks[0]!));
  const normalizedPaperTitle = normalizeTitleForComparison(paperTitle);
  const remainingBlocks = normalizedTitleBlock === normalizedPaperTitle
    ? blocks.slice(1)
    : blocks.slice();

  const { bodyBlocks, referenceHeading, referenceBlocks } = findReferenceSections(remainingBlocks);
  let bodyStarted = false;

  for (const rawBlock of bodyBlocks) {
    // 媒体路径专用：chart 占位 token 独占一段 → chart_image
    // 用 raw lines 检测：占位 token 形如 [[CHART_PLACEHOLDER_N]]，不带 markdown 前缀，
    // 用 raw 还是 stripped 都能匹配
    if (options.enableMedia && isChartPlaceholderBlock(rawBlock)) {
      const paragraph = buildChartImageParagraphModel(rawBlock[0]!.trim());
      if (!bodyStarted) {
        paragraph.pageBreakBefore = true;
        bodyStarted = true;
      }
      paragraphs.push(paragraph);
      continue;
    }

    // 媒体路径专用：markdown 表格 → table（必须在 heading 检测之前，
    // 否则单行表格头会被误识别为 heading）
    // 关键：必须用 raw lines 调 parseTableBlock，否则 cell 里的 "1. 准备" 会被
    // stripLeadingMarkdownSyntax 吞成 "准备"，论文里的步骤表/阶段表编号会无声丢失。
    if (options.enableMedia && isTableBlock(rawBlock)) {
      const rows = parseTableBlock(rawBlock);
      if (rows.length > 0) {
        const paragraph = buildTableParagraphModel(rows);
        if (!bodyStarted) {
          paragraph.pageBreakBefore = true;
          bodyStarted = true;
        }
        paragraphs.push(paragraph);
        continue;
      }
    }

    // 非媒体路径：剥离 markdown 前缀后再做 heading / body 分类
    const block = stripBlockMarkers(rawBlock);
    if (block.length === 0) continue;

    if (isHeadingBlock(block)) {
      const paragraph = buildParagraph('heading', normalizeBlockText(block));
      if (!bodyStarted) {
        paragraph.pageBreakBefore = true;
        bodyStarted = true;
      }
      paragraphs.push(paragraph);
      continue;
    }

    for (const line of block) {
      const paragraph = buildParagraph('body', line);
      if (!bodyStarted) {
        paragraph.pageBreakBefore = true;
        bodyStarted = true;
      }
      paragraphs.push(paragraph);
    }
  }

  const normalizedReferenceEntries = extractReferenceParagraphs(referenceBlocks);
  if (referenceHeading || normalizedReferenceEntries.length > 0) {
    const headingParagraph = buildParagraph('reference_heading', referenceHeading || 'References');
    headingParagraph.pageBreakBefore = true;
    paragraphs.push(headingParagraph);

    for (const referenceText of normalizedReferenceEntries) {
      paragraphs.push(buildParagraph('reference', referenceText));
    }
  }

  return { paragraphs };
}

function toDocxAlignment(alignment: 'left' | 'center') {
  return alignment === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT;
}

function toDocxParagraph(model: PaperParagraphModel) {
  return new Paragraph({
    alignment: toDocxAlignment(model.alignment),
    pageBreakBefore: model.pageBreakBefore,
    spacing: {
      line: DOCX_LINE_SPACING,
      lineRule: LineRuleType.AUTO,
      after: model.kind === 'cover_title' ? 240 : 120,
      before: model.kind === 'cover_course_code'
        ? 3600
        : (model.kind === 'cover_title'
          ? 240
          : (model.kind === 'heading' || model.kind === 'reference_heading' ? 120 : 0)),
    },
    indent: model.hangingIndent ? { left: HANGING_INDENT_TWIPS, hanging: HANGING_INDENT_TWIPS } : undefined,
    children: [
      ...model.runs.map((run) => new TextRun({
        text: run.text,
        bold: model.bold || run.bold,
        italics: run.italics,
        font: model.fontFamily,
        size: DOCX_FONT_SIZE,
      })),
    ],
  });
}

export function buildFormattedPaperDocument(text: string, options: PaperLayoutOptions = {}) {
  const model = buildPaperLayoutModel(text, options);

  return new Document({
    sections: [{
      properties: {},
      children: model.paragraphs.map((paragraph) => toDocxParagraph(paragraph)),
    }],
  });
}

export async function buildFormattedPaperDocBuffer(text: string, options: PaperLayoutOptions = {}) {
  return Packer.toBuffer(buildFormattedPaperDocument(text, options));
}

// ---------------------------------------------------------------------------
// 媒体路径：支持嵌入真实图表 PNG + Markdown 表格 → 原生 Word Table
// ---------------------------------------------------------------------------

type DocxBodyNode = Paragraph | Table;

function buildDocxTable(rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, rowIdx) => new TableRow({
      children: row.map((cell) => new TableCell({
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          children: [new TextRun({
            text: cell,
            bold: rowIdx === 0,
            font: FONT_FAMILY,
            size: DOCX_FONT_SIZE,
          })],
        })],
      })),
    })),
  });
}

function buildChartNodes(rendered: RenderedChart | undefined): Paragraph[] {
  if (rendered?.png) {
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 60 },
        children: [
          new ImageRun({
            // docx 9.x 的 ImageRun 需要 type 字段
            type: 'png',
            data: rendered.png,
            transformation: { width: rendered.width, height: rendered.height },
          } as any),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: rendered.spec.title,
            font: FONT_FAMILY,
            size: DOCX_FONT_SIZE,
            italics: true,
          }),
        ],
      }),
    ];
  }

  // 渲染失败兜底：用两段斜体提示占位（按用户决定：允许部分成功，整篇照常交付）
  const title = rendered?.spec.title || '图表';
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 60 },
      children: [
        new TextRun({
          text: title,
          italics: true,
          font: FONT_FAMILY,
          size: DOCX_FONT_SIZE,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: '（图表暂时无法渲染，请稍后重试或联系客服）',
          italics: true,
          font: FONT_FAMILY,
          size: DOCX_FONT_SIZE,
        }),
      ],
    }),
  ];
}

function toDocxNodes(
  model: PaperParagraphModel,
  mediaMap: Map<string, RenderedChart>,
): DocxBodyNode[] {
  if (model.kind === 'table' && model.tableRows && model.tableRows.length > 0) {
    return [buildDocxTable(model.tableRows)];
  }

  if (model.kind === 'chart_image' && model.chartToken) {
    const rendered = mediaMap.get(model.chartToken);
    return buildChartNodes(rendered);
  }

  return [toDocxParagraph(model)];
}

/**
 * 构造支持图表 + 表格的最终 docx buffer。
 *
 * 调用方需要：
 *  1. 把 Claude 返回的原文先经 `parseRevisionOutput` 处理，得到带 [[CHART_PLACEHOLDER_N]]
 *     占位 token 的 text + charts 数组
 *  2. 把 charts 喂给 `chartRenderService.renderCharts` 拿到 RenderedChart 数组
 *  3. 把 token → RenderedChart 的映射表传进来
 *
 * options.enableMedia 会被强制设为 true，调用方不用关心。
 */
export async function buildFormattedPaperDocBufferWithMedia(
  text: string,
  mediaMap: Map<string, RenderedChart>,
  options: PaperLayoutOptions = {},
) {
  const model = buildPaperLayoutModel(text, { ...options, enableMedia: true });

  const doc = new Document({
    sections: [{
      properties: {},
      children: model.paragraphs.flatMap((paragraph) => toDocxNodes(paragraph, mediaMap)),
    }],
  });

  return Packer.toBuffer(doc);
}
