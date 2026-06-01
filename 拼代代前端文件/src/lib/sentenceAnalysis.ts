export interface SentenceAnalysisSentence {
  sentence?: string;
  score?: number | null;
  label?: string;
}

export interface SentenceAnalysisResultJson {
  human_score?: number;
  ai_score?: number;
  verdict?: 'looks_human' | 'ai_detected';
  scan_version?: string;
  stealthwriter_result_id?: string | null;
  display_text?: string;
  original_text?: string;
  sentences?: SentenceAnalysisSentence[];
  raw?: Record<string, unknown>;
}

export interface SentenceHighlightSegment {
  text: string;
  kind: 'plain' | 'human' | 'ai';
  score?: number | null;
  label?: string;
}

function normalizeText(text?: string | null) {
  return typeof text === 'string' ? text.trim() : '';
}

export function normalizeSentenceScore(score?: number | null): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const normalized = Math.abs(score) <= 1 ? score * 100 : score;
  return Math.max(0, Math.min(100, normalized));
}

export function isHumanSentence(sentence: SentenceAnalysisSentence) {
  const label = sentence.label?.trim().toLowerCase() || '';
  if (label.includes('ai') || label.includes('fail') || label.includes('bot')) {
    return false;
  }
  if (label.includes('human') || label.includes('pass') || label.includes('ok')) {
    return true;
  }

  const normalizedScore = normalizeSentenceScore(sentence.score);
  return normalizedScore === null ? false : normalizedScore >= 50;
}

export function sentenceScoreLabel(score?: number | null) {
  const normalizedScore = normalizeSentenceScore(score);
  if (normalizedScore === null) return null;
  return `${Math.round(normalizedScore)} 分`;
}

export function getSentenceAnalysisDisplayText(result?: SentenceAnalysisResultJson | null) {
  const displayText = normalizeText(result?.display_text);
  if (displayText) return displayText;

  const originalText = normalizeText(result?.original_text);
  if (originalText) return originalText;

  const sentences = (result?.sentences || [])
    .map((sentence) => normalizeText(sentence.sentence))
    .filter(Boolean);

  return sentences.join(' ');
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSentenceRange(text: string, sentence: string, cursor: number) {
  const directStart = text.indexOf(sentence, cursor);
  if (directStart !== -1) {
    return { start: directStart, end: directStart + sentence.length };
  }

  const pattern = new RegExp(
    escapeRegExp(sentence).replace(/\s+/g, '\\s+'),
  );

  const slice = text.slice(cursor);
  const afterCursor = slice.match(pattern);
  if (afterCursor && typeof afterCursor.index === 'number') {
    const start = cursor + afterCursor.index;
    return { start, end: start + afterCursor[0].length };
  }

  const anywhere = text.match(pattern);
  if (anywhere && typeof anywhere.index === 'number') {
    return {
      start: anywhere.index,
      end: anywhere.index + anywhere[0].length,
    };
  }

  return null;
}

export function buildSentenceHighlightSegments(
  result?: SentenceAnalysisResultJson | null,
): SentenceHighlightSegment[] {
  const text = getSentenceAnalysisDisplayText(result);
  if (!text) return [];

  const sentences = (result?.sentences || [])
    .map((sentence) => ({
      ...sentence,
      sentence: normalizeText(sentence.sentence),
    }))
    .filter((sentence) => sentence.sentence);

  if (sentences.length === 0) {
    return [{ text, kind: 'plain' }];
  }

  const segments: SentenceHighlightSegment[] = [];
  let cursor = 0;
  let matchedCount = 0;

  for (const sentence of sentences) {
    const range = findSentenceRange(text, sentence.sentence || '', cursor);
    if (!range) continue;

    if (range.start < cursor) continue;

    if (range.start > cursor) {
      segments.push({
        text: text.slice(cursor, range.start),
        kind: 'plain',
      });
    }

    segments.push({
      text: text.slice(range.start, range.end),
      kind: isHumanSentence(sentence) ? 'human' : 'ai',
      score: sentence.score,
      label: sentence.label,
    });

    cursor = range.end;
    matchedCount += 1;
  }

  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
      kind: 'plain',
    });
  }

  if (matchedCount === 0) {
    return [{ text, kind: 'plain' }];
  }

  return segments.filter((segment) => segment.text);
}
