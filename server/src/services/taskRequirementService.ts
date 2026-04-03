import { normalizeCitationStyle } from './citationStyleService';
import { validateTargetWords } from './requestValidationService';

interface TaskRequirementPrompt {
  systemPrompt: string;
  userPrompt: string;
}

interface ExtractedTaskRequirementPayload {
  targetWords?: number | null;
  citationStyle?: string | null;
  requiredSectionCount?: number | null;
}

export interface UnifiedTaskRequirements {
  targetWords: number;
  citationStyle: string;
  requiredReferenceCount: number;
  requiredSectionCount: number;
}

function safeParseJson(content: string) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeText(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSectionCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 20) {
    return null;
  }
  return parsed;
}

function normalizeTargetWords(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  try {
    return validateTargetWords(parsed);
  } catch {
    return null;
  }
}

function computeRoundedWordUnits(targetWords: number) {
  return Math.max(1, Math.ceil(targetWords / 1000));
}

export function computeRequiredReferenceCount(targetWords: number) {
  return computeRoundedWordUnits(targetWords) * 5;
}

export function computeRequiredSectionCount(targetWords: number) {
  return 3 + (computeRoundedWordUnits(targetWords) - 1);
}

export function buildTaskRequirementExtractionPrompt(input: {
  specialRequirements?: string | null;
}): TaskRequirementPrompt {
  return {
    systemPrompt: `You extract only the explicitly stated target word count and citation style from academic task instructions.

Read every attached material file directly.
If a value is not clearly specified, return null.
Do not infer defaults.
Do not calculate section counts or reference counts.
Return valid JSON only in this shape:
{
  "target_words": number | null,
  "citation_style": "string" | null
}`,
    userPrompt: `Extract the explicitly stated target word count and citation style from the uploaded task requirement files.

Original special requirements:
${normalizeText(input.specialRequirements) || 'None'}

If the materials do not clearly specify one of these values, return null for that field.`,
  };
}

export function normalizeExtractedTaskRequirements(content: string): {
  targetWords: number | null;
  citationStyle: string | null;
  requiredSectionCount: number | null;
} {
  const parsed = safeParseJson(content);
  const citationStyle = normalizeText(typeof parsed?.citation_style === 'string' ? parsed.citation_style : '');

  return {
    targetWords: normalizeTargetWords(parsed?.target_words),
    citationStyle: citationStyle ? normalizeCitationStyle(citationStyle) : null,
    requiredSectionCount: normalizeSectionCount(parsed?.required_section_count),
  };
}

export interface RequirementOverrides {
  targetWords?: number;
  citationStyle?: string;
  requiredSectionCount?: number;
}

/**
 * Parse structured requirement changes from user's editInstruction.
 * Handles patterns like "写3000字", "3000 words", "换成Harvard", "use MLA 9".
 * Returns only detected overrides; empty object means no requirement change.
 */
export function parseRequirementOverrides(editInstruction: string): RequirementOverrides {
  const overrides: RequirementOverrides = {};
  const text = editInstruction.trim();
  if (!text) return overrides;

  // --- Target words extraction ---
  // Chinese: 3000字, 写3000字, 改成3000字, 要求3000字, 目标字数3000
  // English: 3000 words, word count 3000, target words 3000
  const zhWordMatch = text.match(/(\d{3,6})\s*(?:个)?字(?!符|母|体|节|段|典|幕)/);
  const enWordMatch = text.match(/(\d{3,6})\s*words?\b/i);
  const wordCountMatch = text.match(/word\s*count[:\s]*(\d{3,6})/i);
  const targetWordsMatch = text.match(/target\s*words?[:\s]*(\d{3,6})/i);

  const rawWords = zhWordMatch?.[1] || enWordMatch?.[1] || wordCountMatch?.[1] || targetWordsMatch?.[1];
  if (rawWords) {
    const parsed = Number.parseInt(rawWords, 10);
    try {
      overrides.targetWords = validateTargetWords(parsed);
    } catch {
      // Out of range — ignore silently
    }
  }

  // --- Citation style extraction ---
  // Chinese: 换成Harvard, 用APA 7, 引用格式改成MLA
  // English: use Harvard, citation style: APA 7
  const zhStyleMatch = text.match(/(?:换成|改成|改为|用|使用|采用)\s*([A-Za-z][A-Za-z0-9\s.]{1,20})/);
  const enStyleMatch = text.match(/(?:use|switch\s+to|change\s+to|citation\s+style[:\s]*)\s*([A-Za-z][A-Za-z0-9\s.]{1,20})/i);

  const rawStyle = zhStyleMatch?.[1]?.trim() || enStyleMatch?.[1]?.trim();
  if (rawStyle) {
    const normalized = normalizeCitationStyle(rawStyle);
    // Only accept if it looks like a real citation style (not random text after 用/use)
    if (/^(apa|mla|chicago|harvard|ieee|vancouver|ama|acs|turabian)/i.test(normalized)) {
      overrides.citationStyle = normalized;
    }
  }

  // --- Section count extraction ---
  // Chinese: 6个章节, 分6章, 6个部分, 6节
  // English: 6 sections, change to 5 sections
  const zhSectionMatch = text.match(/(\d{1,2})\s*(?:个)?(?:章节|部分|章|节)/);
  const enSectionMatch = text.match(/(\d{1,2})\s*sections?\b/i);
  const rawSections = zhSectionMatch?.[1] || enSectionMatch?.[1];
  if (rawSections) {
    const parsed = Number.parseInt(rawSections, 10);
    if (parsed >= 2 && parsed <= 20) {
      overrides.requiredSectionCount = parsed;
    }
  }

  return overrides;
}

export function deriveUnifiedTaskRequirements(
  input: ExtractedTaskRequirementPayload,
): UnifiedTaskRequirements {
  const targetWords = normalizeTargetWords(input.targetWords) ?? 1000;
  const citationStyle = normalizeCitationStyle(input.citationStyle || 'APA 7');

  // Priority: document-specified section count > word-count formula
  const requiredSectionCount = normalizeSectionCount(input.requiredSectionCount)
    ?? computeRequiredSectionCount(targetWords);

  return {
    targetWords,
    citationStyle,
    requiredReferenceCount: computeRequiredReferenceCount(targetWords),
    requiredSectionCount,
  };
}
