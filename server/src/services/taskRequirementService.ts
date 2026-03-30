import { normalizeCitationStyle } from './citationStyleService';
import { validateTargetWords } from './requestValidationService';

interface TaskRequirementPrompt {
  systemPrompt: string;
  userPrompt: string;
}

interface ExtractedTaskRequirementPayload {
  targetWords?: number | null;
  citationStyle?: string | null;
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
} {
  const parsed = safeParseJson(content);
  const citationStyle = normalizeText(typeof parsed?.citation_style === 'string' ? parsed.citation_style : '');

  return {
    targetWords: normalizeTargetWords(parsed?.target_words),
    citationStyle: citationStyle ? normalizeCitationStyle(citationStyle) : null,
  };
}

export function deriveUnifiedTaskRequirements(
  input: ExtractedTaskRequirementPayload,
): UnifiedTaskRequirements {
  const targetWords = normalizeTargetWords(input.targetWords) ?? 1000;
  const citationStyle = normalizeCitationStyle(input.citationStyle || 'APA 7');

  return {
    targetWords,
    citationStyle,
    requiredReferenceCount: computeRequiredReferenceCount(targetWords),
    requiredSectionCount: computeRequiredSectionCount(targetWords),
  };
}
