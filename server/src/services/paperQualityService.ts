export interface OutlineReadinessAssessment {
  valid: boolean;
  reasons: string[];
}

export interface GeneratedPaperAssessment {
  valid: boolean;
  shouldRepair: boolean;
  reasons: string[];
}

const PLACEHOLDER_PATTERNS = [
  /\[research question\]/i,
  /\[topic\]/i,
  /\[paper title\]/i,
  /\[title\]/i,
  /\[thesis\]/i,
];

const GENERIC_TITLE_PATTERNS = [
  /\bmarking criteria\b/i,
  /\brubric\b/i,
  /\bwriting guide\b/i,
  /\bassessment task information\b/i,
  /\btask information\b/i,
  /\bsyllabus\b/i,
  /\breport instructions?\b/i,
  /\bassignment brief\b/i,
];

const REFUSAL_PATTERNS = [
  /please provide the topic/i,
  /please provide the exact research question/i,
  /cannot be written responsibly without/i,
  /cannot responsibly write/i,
  /need the topic/i,
  /need the research question/i,
];

function normalize(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function containsPlaceholder(value: string) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function looksLikeGenericTitle(title: string, blockedFileTitles: string[]) {
  if (GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return true;
  }

  const normalizedTitle = normalize(stripKnownFileExtensions(title));

  return blockedFileTitles.some((fileTitle) => {
    const exact = fileTitle && fileTitle.localeCompare(title, undefined, { sensitivity: 'accent' }) === 0;
    if (exact) {
      return true;
    }

    return normalize(stripKnownFileExtensions(fileTitle)) === normalizedTitle;
  });
}

function hasInTextCitation(text: string) {
  return /\([^)]+,\s*(19|20)\d{2}[a-z]?\)/.test(text)
    || /\b[A-Z][A-Za-z-]+(?:\s+et al\.)?\s*\((19|20)\d{2}[a-z]?\)/.test(text);
}

function extractReferenceEntries(text: string) {
  const headingMatch = text.match(/(?:^|\n)\s*(references|reference list|bibliography|works cited)\s*(?:\n|$)/i);
  if (!headingMatch || headingMatch.index === undefined) {
    return [];
  }

  const start = headingMatch.index + headingMatch[0].length;
  return text
    .slice(start)
    .split(/\n\s*\n/)
    .map((entry) => entry.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function assessOutlineReadiness(
  payload: {
    paper_title?: string | null;
    research_question?: string | null;
    outline?: string | null;
  },
  options: {
    blockedFileTitles?: string[];
  } = {},
): OutlineReadinessAssessment {
  const reasons: string[] = [];
  const paperTitle = normalize(payload.paper_title);
  const researchQuestion = normalize(payload.research_question);
  const outline = normalize(payload.outline);
  const blockedFileTitles = (options.blockedFileTitles || []).map((value) => normalize(value)).filter(Boolean);

  if (!paperTitle) {
    reasons.push('missing title');
  } else if (containsPlaceholder(paperTitle) || looksLikeGenericTitle(paperTitle, blockedFileTitles)) {
    reasons.push('invalid title');
  }

  if (!researchQuestion) {
    reasons.push('missing research question');
  } else if (containsPlaceholder(researchQuestion)) {
    reasons.push('invalid research question');
  }

  if (!outline) {
    reasons.push('missing outline');
  } else if (containsPlaceholder(outline)) {
    reasons.push('outline still contains placeholder text');
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

export function assessGeneratedPaper(text: string | null | undefined): GeneratedPaperAssessment {
  const normalized = String(text || '').trim();
  const reasons: string[] = [];

  if (!normalized) {
    reasons.push('empty paper');
  }

  if (REFUSAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    reasons.push('refusal content');
  }

  if (!hasInTextCitation(normalized)) {
    reasons.push('missing citation');
  }

  const referenceEntries = extractReferenceEntries(normalized);
  if (referenceEntries.length === 0) {
    reasons.push('missing references');
  }

  return {
    valid: reasons.length === 0,
    shouldRepair: reasons.length > 0,
    reasons,
  };
}
import { stripKnownFileExtensions } from './paperTitleService';
