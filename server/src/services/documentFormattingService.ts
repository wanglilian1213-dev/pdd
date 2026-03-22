import {
  AlignmentType,
  Document,
  LineRuleType,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

export type PaperParagraphKind = 'title' | 'heading' | 'body' | 'reference_heading' | 'reference';

export interface PaperParagraphModel {
  kind: PaperParagraphKind;
  text: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  alignment: 'left' | 'center';
  lineSpacing: number;
  hangingIndent: boolean;
}

interface PaperLayoutModel {
  paragraphs: PaperParagraphModel[];
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
    bold: kind === 'title' || kind === 'heading' || kind === 'reference_heading',
    alignment: kind === 'title' ? 'center' : 'left',
    lineSpacing: LINE_SPACING,
    hangingIndent: kind === 'reference',
  };
}

function extractReferenceParagraphs(blocks: string[][]) {
  if (blocks.length === 0) {
    return [];
  }

  const singleLineEntries = blocks
    .flatMap((block) => block.map((line) => cleanInlineFormatting(line)).filter(Boolean));

  if (singleLineEntries.length > blocks.length) {
    return singleLineEntries;
  }

  if (blocks.every((block) => block.length === 1)) {
    return blocks.map((block) => block[0]!).filter(Boolean);
  }

  return blocks.map((block) => block.join(' ')).filter(Boolean);
}

export function buildPaperLayoutModel(text: string): PaperLayoutModel {
  const blocks = splitIntoBlocks(text);
  if (blocks.length === 0) {
    return { paragraphs: [] };
  }

  const [titleBlock, ...remainingBlocks] = blocks;
  const paragraphs: PaperParagraphModel[] = [];

  paragraphs.push(buildParagraph('title', titleBlock!.join(' ')));

  let referenceStart = remainingBlocks.findIndex((block) => isReferenceHeading(block.join(' ')));
  if (referenceStart === -1) {
    referenceStart = remainingBlocks.length;
  }

  const bodyBlocks = remainingBlocks.slice(0, referenceStart);
  const referenceBlocks = remainingBlocks.slice(referenceStart);

  for (const block of bodyBlocks) {
    if (isHeadingBlock(block)) {
      paragraphs.push(buildParagraph('heading', block[0]!));
      continue;
    }

    for (const line of block) {
      paragraphs.push(buildParagraph('body', line));
    }
  }

  if (referenceBlocks.length > 0) {
    const [referenceHeadingBlock, ...referenceContentBlocks] = referenceBlocks;
    paragraphs.push(buildParagraph('reference_heading', referenceHeadingBlock!.join(' ')));

    for (const referenceText of extractReferenceParagraphs(referenceContentBlocks)) {
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
    spacing: {
      line: DOCX_LINE_SPACING,
      lineRule: LineRuleType.AUTO,
      after: model.kind === 'title' ? 240 : 120,
      before: model.kind === 'heading' || model.kind === 'reference_heading' ? 120 : 0,
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

export function buildFormattedPaperDocument(text: string) {
  const model = buildPaperLayoutModel(text);

  return new Document({
    sections: [{
      properties: {},
      children: model.paragraphs.map((paragraph) => toDocxParagraph(paragraph)),
    }],
  });
}

export async function buildFormattedPaperDocBuffer(text: string) {
  return Packer.toBuffer(buildFormattedPaperDocument(text));
}
