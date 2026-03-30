import {
  AlignmentType,
  Document,
  LineRuleType,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { normalizeDeliveryPaperTitle } from './paperTitleService';

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
  runs: PaperTextRunModel[];
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  alignment: 'left' | 'center';
  lineSpacing: number;
  hangingIndent: boolean;
  pageBreakBefore: boolean;
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

function splitIntoBlocks(text: string) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n\s*\n/)
    .map((block) => block
      .split('\n')
      .map((line) => stripLeadingMarkdownSyntax(line))
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
