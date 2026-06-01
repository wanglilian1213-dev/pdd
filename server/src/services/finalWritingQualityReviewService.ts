import { streamResponseText } from '../lib/openai';
import { buildMainOpenAIResponsesOptions } from '../lib/openaiMainConfig';
import type { MaterialInputPart } from './materialInputService';
import type { WritingQualityRequirementProfile } from './writingQualityGateService';

export interface FinalWritingQualityReview {
  format_pass: boolean;
  requirement_pass: boolean;
  rubric_pass: boolean;
  reasons: string[];
}

export interface FinalWritingQualityReviewInput {
  finalText: string;
  specialRequirements: string;
  outline: string;
  profile: WritingQualityRequirementProfile;
  materialParts?: MaterialInputPart[];
}

const FINAL_QUALITY_REVIEW_TIMEOUT_MS = 600_000;

class FinalWritingQualityReviewTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`quality_gate_failed:final_review_timeout:${timeoutMs}ms`);
    this.name = 'FinalWritingQualityReviewTimeoutError';
  }
}

function stripJsonFence(text: string) {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

export function parseFinalWritingQualityReview(text: string): FinalWritingQualityReview | null {
  try {
    const cleaned = stripJsonFence(text);
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned) as Partial<FinalWritingQualityReview>;

    if (
      typeof parsed.format_pass !== 'boolean'
      || typeof parsed.requirement_pass !== 'boolean'
      || typeof parsed.rubric_pass !== 'boolean'
      || !Array.isArray(parsed.reasons)
    ) {
      return null;
    }

    return {
      format_pass: parsed.format_pass,
      requirement_pass: parsed.requirement_pass,
      rubric_pass: parsed.rubric_pass,
      reasons: parsed.reasons.map((reason) => String(reason)).filter(Boolean).slice(0, 8),
    };
  } catch {
    return null;
  }
}

export function assertFinalWritingQualityReview(review: FinalWritingQualityReview, profile: WritingQualityRequirementProfile) {
  const failureCodes: string[] = [];

  if (!review.format_pass) failureCodes.push('final_format_review_failed');
  if (!review.requirement_pass) failureCodes.push('final_requirement_review_failed');
  if (profile.requiresRubricReview && !review.rubric_pass) failureCodes.push('final_rubric_review_failed');

  if (failureCodes.length > 0) {
    throw new Error(`quality_gate_failed:${failureCodes.join(',')}:${review.reasons.join(' | ')}`);
  }
}

function buildFinalWritingQualityReviewPrompt(input: FinalWritingQualityReviewInput) {
  return `You are the final quality checker for an academic writing delivery.

Check two independent areas:
1. Formatting and layout readiness: no raw code fences, no chart DSL, no placeholders, clear section headings, references section present when citations are used, no obvious malformed tables, and required Word-specific features such as footnotes, endnotes, page numbers, title page, table of contents, block quotes, captions, and appendices are actually present when requested.
2. User/assignment/rubric fit: build an internal checklist from every explicit user requirement, assignment brief requirement, rubric criterion, requested section, requested method, data-analysis request, figure/table request, citation rule, and closed-book/source restriction. Check citation-style specifics such as OSCOLA, Bluebook, Chicago Notes-Bibliography, MLA Works Cited, Harvard, APA 7, page/slide numbers, case/statute citation, direct quote authenticity, and whether old primary sources are allowed by the task. Check high-risk requirement specifics: current law/latest policy must use current official sources with exact dates and jurisdiction boundaries; IRB/ethics approval, consent, and approval IDs must not be invented; interview participants and private coordinates/exact locations must be anonymized or aggregated when required; finance forecasts, TAM/SAM/SOM, DCF, NPV, IRR, exchange-rate, and market-size claims must expose assumptions and must not become personalized investment advice or guaranteed returns. The final paper must satisfy every item. If any item is missing, contradicted, or only vaguely addressed, set requirement_pass=false and name the missed item in reasons.
3. Rubric fit: if rubric/marking criteria were detected, check whether the paper appears aligned with each visible rubric criterion instead of only being generally academic. Automatic-fail, knockout, cap, or mandatory-section rules override conflicting user preferences. If any visible rubric criterion is missing, set rubric_pass=false and name it.

Return ONLY valid JSON:
{
  "format_pass": boolean,
  "requirement_pass": boolean,
  "rubric_pass": boolean,
  "reasons": string[]
}

Detected quality signals: ${input.profile.signals.join(', ') || 'none'}
Special requirements:
${input.specialRequirements || '(none)'}

Confirmed outline:
${input.outline || '(none)'}

Final paper:
${input.finalText}`;
}

async function withFinalReviewTimeout<T>(operation: Promise<T>, timeoutMs = FINAL_QUALITY_REVIEW_TIMEOUT_MS): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new FinalWritingQualityReviewTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function runFinalWritingQualityReview(input: FinalWritingQualityReviewInput) {
  const { text } = await withFinalReviewTimeout(streamResponseText({
    ...buildMainOpenAIResponsesOptions('final_quality_review'),
    instructions: buildFinalWritingQualityReviewPrompt(input),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text' as const,
            text: 'Review the final paper and return the JSON verdict only. Uploaded assignment, brief, rubric, and dataset files follow when available; use them to judge requirement and rubric fit.',
          },
          ...(input.materialParts || []),
        ],
      },
    ],
  } as any));

  const review = parseFinalWritingQualityReview(text);
  if (!review) {
    throw new Error('quality_gate_failed:final_review_unparseable');
  }

  assertFinalWritingQualityReview(review, input.profile);
  return review;
}

export const finalWritingQualityReviewTestUtils = {
  withFinalReviewTimeout,
  FINAL_QUALITY_REVIEW_TIMEOUT_MS,
  buildFinalWritingQualityReviewPrompt,
};
