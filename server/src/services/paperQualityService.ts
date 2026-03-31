import { stripKnownFileExtensions } from './paperTitleService';

export interface OutlineReadinessAssessment {
  valid: boolean;
  reasons: string[];
}

export interface GeneratedPaperAssessment {
  valid: boolean;
  shouldRepair: boolean;
  reasons: string[];
}

export interface GeneratedPaperAssessmentOptions {
  requiredReferenceCount?: number;
  citationStyle?: string | null;
}

export interface ReferenceEntryAnalysis {
  entry: string;
  year: number | null;
  isBefore2020: boolean;
  looksLikeBook: boolean;
  looksLikeAcademicPaper: boolean;
}

export interface ReferenceComplianceSummary {
  referenceEntries: string[];
  analyses: ReferenceEntryAnalysis[];
  totalReferences: number;
  referencesFrom2020Onward: number;
  likelyAcademicPaperCount: number;
  suspectedBookCount: number;
  suspectedNonAcademicCount: number;
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

const BOOK_PATTERNS = [
  /\b(university\s+press|oxford\s+university\s+press|cambridge\s+university\s+press)\b/i,
  /\bpublisher\b/i,
  /\bpress\b/i,
  /\bisbn\b/i,
  /\bhandbook\b/i,
  /\bedition\b/i,
];

const ACADEMIC_PAPER_PATTERNS = [
  /https?:\/\/doi\.org\//i,
  /\bdoi:\s*/i,
  /\bjournal\b/i,
  /\b\d+\(\d+\)\b/,
  /\bvol(?:ume)?\b/i,
  /\bissue\b/i,
  /\bstudies\b/i,
  /\breview\b/i,
  /\bproceedings\b/i,
  /\bquarterly\b/i,
];

const NON_ACADEMIC_SOURCE_PATTERNS = [
  /\blibrary\b/i,
  /\bresearch guide\b/i,
  /\bmarking criteria\b/i,
  /\bwriting guide\b/i,
  /\bassessment brief\b/i,
  /\bcourse document\b/i,
  /\btask information\b/i,
  /\bkaplan international\b/i,
];

const BULLET_LINE_PATTERN = /^\s*[-*•●▪◦]\s+/;

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

function getOutlineSectionCount(outline: string) {
  const lines = outline.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.filter((line) => !BULLET_LINE_PATTERN.test(line)).length;
}

export function extractReferenceEntries(text: string) {
  const headingMatch = text.match(/(?:^|\n)\s*(references|reference list|bibliography|works cited)\s*(?:\n|$)/i);
  if (!headingMatch || headingMatch.index === undefined) {
    return [];
  }

  const referenceBody = text.slice(headingMatch.index + headingMatch[0].length);
  const lines = referenceBody
    .split(/\r?\n/)
    .map((line) => line.trim());
  const entries: string[] = [];
  let currentEntry = '';

  const startsNewReference = (line: string) => (
    /^[A-Z][A-Za-z'`.-]+(?:\s+[A-Z][A-Za-z'`.-]+)*,\s*[A-Z]/.test(line)
    || /^[^()]+?\(\d{4}[a-z]?\)\./i.test(line)
  );

  for (const line of lines) {
    if (!line) {
      if (currentEntry) {
        entries.push(currentEntry.replace(/\s+/g, ' ').trim());
        currentEntry = '';
      }
      continue;
    }

    if (!currentEntry) {
      currentEntry = line;
      continue;
    }

    if (startsNewReference(line)) {
      entries.push(currentEntry.replace(/\s+/g, ' ').trim());
      currentEntry = line;
      continue;
    }

    currentEntry = `${currentEntry} ${line}`.replace(/\s+/g, ' ').trim();
  }

  if (currentEntry) {
    entries.push(currentEntry.replace(/\s+/g, ' ').trim());
  }

  return entries;
}

function analyzeReferenceEntry(entry: string): ReferenceEntryAnalysis {
  const normalizedEntry = normalize(entry);
  const years = Array.from(normalizedEntry.matchAll(/\b(19|20)\d{2}\b/g))
    .map((match) => Number(match[0]))
    .filter((value) => Number.isInteger(value));
  const year = years.length > 0 ? years[0] : null;
  const looksLikeBook = BOOK_PATTERNS.some((pattern) => pattern.test(normalizedEntry));
  const hasAuthorYearShape = /^[^()]+?\(\d{4}[a-z]?\)\./i.test(normalizedEntry)
    || /[A-Z][A-Za-z'’.-]+[^()]*\(\d{4}[a-z]?\)\./.test(normalizedEntry);
  const hasResolvableLink = /https?:\/\/\S+/i.test(normalizedEntry);
  const hasExplicitAcademicMarkers = ACADEMIC_PAPER_PATTERNS.some((pattern) => pattern.test(normalizedEntry));
  const hasExplicitNonAcademicMarkers = NON_ACADEMIC_SOURCE_PATTERNS.some((pattern) => pattern.test(normalizedEntry));
  const looksLikeAcademicPaper = !looksLikeBook
    && !hasExplicitNonAcademicMarkers
    && (hasExplicitAcademicMarkers || hasAuthorYearShape || hasResolvableLink);

  return {
    entry: normalizedEntry,
    year,
    isBefore2020: typeof year === 'number' && year < 2020,
    looksLikeBook,
    looksLikeAcademicPaper,
  };
}

export function summarizeReferenceCompliance(text: string): ReferenceComplianceSummary {
  const referenceEntries = extractReferenceEntries(text);
  const analyses = referenceEntries.map((entry) => analyzeReferenceEntry(entry));

  return {
    referenceEntries,
    analyses,
    totalReferences: referenceEntries.length,
    referencesFrom2020Onward: analyses.filter((analysis) => typeof analysis.year === 'number' && analysis.year >= 2020).length,
    likelyAcademicPaperCount: analyses.filter((analysis) => analysis.looksLikeAcademicPaper).length,
    suspectedBookCount: analyses.filter((analysis) => analysis.looksLikeBook).length,
    suspectedNonAcademicCount: analyses.filter((analysis) => !analysis.looksLikeAcademicPaper).length,
  };
}

function hasObviousCitationStyleConflict(summary: ReferenceComplianceSummary, citationStyle?: string | null) {
  const normalizedStyle = normalize(citationStyle);
  if (!normalizedStyle || summary.referenceEntries.length === 0) {
    return false;
  }

  if (/apa/i.test(normalizedStyle)) {
    return summary.referenceEntries.every((entry) => !/\(\d{4}[a-z]?\)/.test(entry));
  }

  return false;
}

export function assessOutlineReadiness(
  payload: {
    paper_title?: string | null;
    research_question?: string | null;
    outline?: string | null;
  },
  options: {
    blockedFileTitles?: string[];
    requiredSectionCount?: number;
  } = {},
): OutlineReadinessAssessment {
  const reasons: string[] = [];
  const paperTitle = normalize(payload.paper_title);
  const researchQuestion = normalize(payload.research_question);
  const rawOutline = String(payload.outline || '').trim();
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

  if (rawOutline && typeof options.requiredSectionCount === 'number') {
    const sectionCount = getOutlineSectionCount(rawOutline);
    if (sectionCount !== options.requiredSectionCount) {
      reasons.push(`section count mismatch (${sectionCount}/${options.requiredSectionCount})`);
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

export function assessGeneratedPaper(
  text: string | null | undefined,
  options: GeneratedPaperAssessmentOptions = {},
): GeneratedPaperAssessment {
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

  const summary = summarizeReferenceCompliance(normalized);
  if (summary.totalReferences === 0) {
    reasons.push('missing references');
  }

  if (typeof options.requiredReferenceCount === 'number' && summary.totalReferences < options.requiredReferenceCount) {
    reasons.push(`reference count below required minimum (${summary.totalReferences}/${options.requiredReferenceCount})`);
  }

  if (summary.analyses.some((analysis) => analysis.isBefore2020)) {
    reasons.push('references must be from 2020 onwards');
  }

  const totalRefs = summary.analyses.length;
  const badRefCount = summary.analyses.filter((analysis) => analysis.looksLikeBook || !analysis.looksLikeAcademicPaper).length;
  if (totalRefs > 0 && badRefCount / totalRefs > 0.3) {
    reasons.push('references must be academic scholar papers, not books');
  }

  if (hasObviousCitationStyleConflict(summary, options.citationStyle)) {
    reasons.push(`references do not appear to match ${normalize(options.citationStyle)} format`);
  }

  return {
    valid: reasons.length === 0,
    shouldRepair: reasons.length > 0,
    reasons,
  };
}
