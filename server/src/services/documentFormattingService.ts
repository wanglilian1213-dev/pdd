import {
  AlignmentType,
  Document,
  LineRuleType,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

export type PaperParagraphKind =
  | 'cover_course_code'
  | 'cover_title'
  | 'heading'
  | 'body'
  | 'reference_heading'
  | 'reference';

export interface PaperParagraphModel {
  kind: PaperParagraphKind;
  text: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  alignment: 'left' | 'center';
  lineSpacing: number;
  hangingIndent: boolean;
  pageBreakBefore: boolean;
}

interface PaperLayoutModel {
  paragraphs: PaperParagraphModel[];
}

interface PaperLayoutOptions {
  paperTitle?: string | null;
  courseCode?: string | null;
}

const FONT_FAMILY = 'Times New Roman';
const FONT_SIZE = 12;
const LINE_SPACING = 1.5;
const DOCX_FONT_SIZE = FONT_SIZE * 2;
const DOCX_LINE_SPACING = 360;
const HANGING_INDENT_TWIPS = 720;
const REFERENCE_HEADINGS = new Set(['references', 'reference list', 'bibliography', 'works cited']);

function cleanInlineFormatting(value: string) {
  return value
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .trim();
}

function splitIntoBlocks(text: string) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n\s*\n/)
    .map((block) => block
      .split('\n')
      .map((line) => cleanInlineFormatting(line))
      .filter(Boolean))
    .filter((lines) => lines.length > 0);
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
  const trimmed = cleanInlineFormatting(text);

  return {
    kind,
    text: trimmed,
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
      .map((line) => cleanInlineFormatting(line))
      .filter(Boolean);

    if (lines.length === 0) {
      continue;
    }

    let currentReference = '';
    for (const line of lines) {
      const startsNewReference = /^[A-Z][A-Za-z'`.-]+(?:\s+[A-Z][A-Za-z'`.-]+)*,\s*[A-Z]/.test(line);
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
    .map((line) => cleanInlineFormatting(line))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export function buildPaperLayoutModel(text: string, options: PaperLayoutOptions = {}): PaperLayoutModel {
  const blocks = splitIntoBlocks(text);
  const paragraphs: PaperParagraphModel[] = [];
  const paperTitle = cleanInlineFormatting(options.paperTitle || normalizeBlockText(blocks[0] || ['Untitled Paper']));
  const courseCode = cleanInlineFormatting(options.courseCode || '');

  paragraphs.push(buildParagraph('cover_course_code', courseCode));
  paragraphs.push(buildParagraph('cover_title', paperTitle));

  if (blocks.length === 0) {
    return { paragraphs };
  }

  const normalizedTitleBlock = normalizeBlockText(blocks[0]!);
  const remainingBlocks = normalizedTitleBlock.localeCompare(paperTitle, undefined, { sensitivity: 'accent' }) === 0
    ? blocks.slice(1)
    : blocks.slice();

  const { bodyBlocks, referenceHeading, referenceBlocks } = findReferenceSections(remainingBlocks);
  let bodyStarted = false;

  for (const block of bodyBlocks) {
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
      new TextRun({
        text: model.text,
        bold: model.bold,
        font: model.fontFamily,
        size: DOCX_FONT_SIZE,
      }),
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
