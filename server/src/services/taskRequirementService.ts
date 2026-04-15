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
  /**
   * 只有当 GPT 能从材料里引用一段明确列出 section 清单的文字时才会非空（e.g.
   * "The report MUST contain: Introduction, Literature Review, Methodology, Findings, Discussion, Conclusion"）。
   * 后端用这个做白名单判断；evidence 为 null / 过短 / 不含 section 类关键词时，强制回退公式。
   */
  structureEvidence?: string | null;
  /**
   * 当调用方能保证 requiredSectionCount 来自可信来源（例如 DB 持久化值、用户手动 override、
   * 已经通过 evidence 校验的值），设为 true 跳过 structureEvidence 白名单检查、直接采纳。
   * 默认 false —— 只有 GPT 首次从材料里引用到显式结构清单时才采纳。
   */
  trustSectionCount?: boolean;
}

/**
 * 白名单判断：GPT 返回的 structure_evidence 是否足够支撑采纳它给的 section count。
 * 要求：非空、至少 25 字、包含 section / chapter / part 这类关键词之一。
 */
function isStructureEvidenceSufficient(evidence: string | null | undefined): boolean {
  if (!evidence) return false;
  const trimmed = evidence.trim();
  if (trimmed.length < 25) return false;
  return /section|chapter|part\b|组成|章节|部分/i.test(trimmed);
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
  structureEvidence: string | null;
} {
  const parsed = safeParseJson(content);
  const citationStyle = normalizeText(typeof parsed?.citation_style === 'string' ? parsed.citation_style : '');
  const rawEvidence = typeof parsed?.structure_evidence === 'string' ? parsed.structure_evidence.trim() : '';

  return {
    targetWords: normalizeTargetWords(parsed?.target_words),
    citationStyle: citationStyle ? normalizeCitationStyle(citationStyle) : null,
    requiredSectionCount: normalizeSectionCount(parsed?.required_section_count),
    structureEvidence: rawEvidence || null,
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

  // 章节数量决定逻辑（硬产品规则，优先级从高到低）：
  //   1. 如果材料里明确列出 section 清单（GPT 能从材料里引证一段 >= 25 字、包含 section/chapter/part 关键词的文字），
  //      采纳 GPT 返回的 requiredSectionCount；
  //   2. 否则，一律走公式：3 章 + (ceil(targetWords / 1000) - 1)。
  // 这样能挡住 "1000 字任务 GPT 自由发挥返回 4 章" 这种越俎代庖的情况，
  // 又不会误伤 "老师明确要求 6 章" 的显式结构作业。
  const gptSectionCount = normalizeSectionCount(input.requiredSectionCount);
  const formulaSectionCount = computeRequiredSectionCount(targetWords);
  const acceptGptSectionCount =
    gptSectionCount != null &&
    (input.trustSectionCount === true || isStructureEvidenceSufficient(input.structureEvidence));
  const requiredSectionCount = acceptGptSectionCount ? gptSectionCount! : formulaSectionCount;

  return {
    targetWords,
    citationStyle,
    requiredReferenceCount: computeRequiredReferenceCount(targetWords),
    requiredSectionCount,
  };
}
