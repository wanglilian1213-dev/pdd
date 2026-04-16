import type { HintedRole } from './scoringMaterialService';

// ----- 场景 ----------------------------------------------------------------

/**
 * 评审场景：
 *  - 'rubric'       有评分标准文件（严格按 rubric 维度打分）
 *  - 'brief_only'   只有任务要求，没有 rubric（默认 5 维度，按 brief 重点微调权重）
 *  - 'article_only' 只有文章本身（默认 5 维度 + 默认权重）
 */
export type ScoringScenario = 'rubric' | 'brief_only' | 'article_only';

/**
 * 根据所有文件的预判角色决定评分场景。
 * - 任一文件预判是 rubric → 'rubric'
 * - 否则任一文件预判是 brief → 'brief_only'
 * - 其它 → 'article_only'
 */
export function detectScenario(hintedRoles: HintedRole[]): ScoringScenario {
  if (hintedRoles.includes('rubric')) return 'rubric';
  if (hintedRoles.includes('brief')) return 'brief_only';
  return 'article_only';
}

export interface ScoringPromptContext {
  scenario: ScoringScenario;
  files: Array<{ filename: string; hintedRole: HintedRole }>;
}

// ----- SYSTEM prompt --------------------------------------------------------

/**
 * 评审主 system prompt。锚定 75-84 区间 + 反吹毛求疵 + JSON 输出。
 * 项目里第一份 scoring prompt 与现有主写作链路的软约束 JSON 风格保持一致。
 */
export const SCORING_SYSTEM_PROMPT_EN = `You are a seasoned academic mentor who grades undergraduate and graduate papers with precision and constructive judgment. Your task is to produce a rigorous, fair assessment of the submitted article.

## Absolute Rules

1. Anchor to the provided baseline. If a rubric is uploaded, grade strictly against the rubric's dimensions — do not invent extra dimensions. If only an assignment brief is uploaded, use the default five dimensions as the skeleton and weight them by the emphasis visible in the brief (weights must still sum to 100). If only an article is uploaded, use the default five dimensions at their default weights.

2. Every deduction must be evidenced. When deducting points on a dimension, cite: (a) a direct quotation or close paraphrase from the article, (b) the specific rubric criterion or brief requirement it violates, (c) why it is a substantive (not cosmetic) problem. Weaknesses missing any of these three parts are not allowed.

3. Tolerance list — do NOT deduct for the following (mention at most in passing):
   - Fewer than 3 typos / punctuation slips in the whole paper
   - Sentences that are long but grammatically correct
   - Citing legitimate peer-reviewed journals that happen not to be top-tier
   - Active-vs-passive voice style preferences
   - "Nice-to-have" suggestions that are not required by rubric/brief

4. No padding weaknesses. If a dimension is genuinely strong, write ["No substantive weaknesses identified."] as that dimension's weaknesses. Never fabricate complaints to look rigorous.

5. Score anchors (0–100), apply strictly:
   - 95–100 : Outstanding. Exemplar of the type.
   - 85–94  : Excellent. Exceeds rubric/brief expectations.
   - 75–84  : Good. Fully meets rubric/brief requirements. ANY paper that simply meets the requirements belongs in this band.
   - 60–74  : Competent but with non-trivial gaps.
   - <60    : Serious problems (missing required sections, off-topic, unsupported claims, fabricated citations).

6. Output ONLY valid JSON matching this schema. No prose outside the JSON:
   {
     "overall_score": integer 0-100,
     "overall_comment": string (2-4 sentences, mentor tone),
     "dimensions": [{
       "name": string,
       "weight": integer 0-100,
       "score": integer 0-100,
       "strengths": string[],
       "weaknesses": string[],
       "suggestions": string[]
     }],
     "top_suggestions": string[],
     "detected_files": [{
       "filename": string,
       "role": "article" | "rubric" | "brief" | "other",
       "note": string
     }]
   }
   Weights across all dimensions must sum to 100. strengths: 1-4 items. weaknesses: 0-4 items (use ["No substantive weaknesses identified."] when genuinely strong). suggestions: 1-3 concrete actionable items. top_suggestions: 3-6 items ordered by expected impact. filename must match exactly what was given. note is optional (one sentence) when overriding a hinted role.

7. Tone. Write as a seasoned mentor, not a hostile reviewer. Praise must be specific ("the literature review synthesises six post-2020 empirical studies" beats "good review"). Criticism must be constructive and actionable. If the paper is good overall, say so plainly.

## Default five dimensions (only when no rubric provided)
1. Content & argument — 30%
2. Argumentation & evidence — 25%
3. Structure & logic — 20%
4. Language & expression — 15%
5. Citation format — 10%

## Language (HARD RULE - overrides any earlier rule)
- Write overall_comment, every dimension's strengths / weaknesses / suggestions, and every entry in top_suggestions in 简体中文, regardless of the article's original language.
- Dimension names: keep exactly as the rubric defines (if a rubric is uploaded). When no rubric is uploaded, use these default English names verbatim: "Content & argument", "Argumentation & evidence", "Structure & logic", "Language & expression", "Citation format". Do not translate the dimension names.
- When quoting or referencing the article's content inside Chinese narrative, keep the original quote in its original language inside quotation marks, e.g. 论文里写道 "these factors are important", 但缺少具体说明.
- Filenames in detected_files must remain exactly as provided (do not translate).`;

export function buildScoringSystemPrompt(): string {
  return SCORING_SYSTEM_PROMPT_EN;
}

// ----- USER message --------------------------------------------------------

const SCENARIO_SUFFIX: Record<ScoringScenario, string> = {
  rubric:
    "A rubric has been uploaded. Grade strictly against the rubric's dimensions and weights — do not add dimensions the rubric does not mention.",
  brief_only:
    "An assignment brief has been uploaded but no rubric. Use the five default dimensions as the skeleton and adjust weights to reflect the brief's emphasis (ensure they sum to 100).",
  article_only:
    'Only the article itself is provided. Use the five default dimensions at their default weights (30/25/20/15/10).',
};

/**
 * 组装 USER 首条消息（不含具体材料 parts）。
 * 调用方把返回字符串放进第一个 `input_text` part，再把实际文件 parts 依次跟后面。
 */
export function buildScoringUserMessage(ctx: ScoringPromptContext): string {
  const fileList =
    ctx.files.length > 0
      ? ctx.files
          .map((f, idx) => `${idx + 1}. ${f.filename} — hinted role: ${f.hintedRole}`)
          .join('\n')
      : '(no files listed)';

  return [
    'I have uploaded the following materials (each prefixed with a heuristic role hint — override in detected_files when needed):',
    '',
    fileList,
    '',
    SCENARIO_SUFFIX[ctx.scenario],
    '',
    'Return only the JSON object specified in the system instructions.',
  ].join('\n');
}

/**
 * 第二次重试时 append 的补充提示（提醒 GPT 上次 JSON 不合法、要精简避免截断）。
 */
export function buildScoringRetryHint(errors: string[]): string {
  const summary = errors.slice(0, 5).join('; ');
  return [
    '',
    '--- Retry instruction ---',
    `Your previous response was not valid JSON matching the schema. Errors: ${summary}.`,
    'Return a strictly valid JSON object that matches the schema exactly. Keep strengths / weaknesses / suggestions concise (one sentence each) to avoid truncation.',
  ].join('\n');
}

// ----- JSON 解析 & 校验 ----------------------------------------------------

/**
 * 软解析：先直接 JSON.parse，失败则用正则抠最大 {...} 块再 parse。
 * 和 taskRequirementService.safeParseJson / 引用核验报告的做法保持一致。
 */
export function parseScoringJson(text: string): Record<string, unknown> | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // fall through
  }

  // 去掉 ```json ... ``` 这类 code fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  // 贪婪抠第一个 { 到最后一个 } 之间的内容
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  return null;
}

export interface ScoringDimension {
  name: string;
  weight: number;
  score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

export interface ScoringDetectedFile {
  filename: string;
  role: 'article' | 'rubric' | 'brief' | 'other';
  note?: string;
}

export interface ScoringResult {
  overall_score: number;
  overall_comment: string;
  dimensions: ScoringDimension[];
  top_suggestions: string[];
  detected_files: ScoringDetectedFile[];
}

export type ScoringValidation =
  | { ok: true; result: ScoringResult }
  | { ok: false; errors: string[] };

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(
  value: unknown,
  minLen: number,
  maxLen: number,
): { ok: boolean; reason?: string } {
  if (!Array.isArray(value)) return { ok: false, reason: 'not an array' };
  if (value.length < minLen || value.length > maxLen) {
    return { ok: false, reason: `length ${value.length} out of [${minLen}, ${maxLen}]` };
  }
  for (const item of value) {
    if (!isNonEmptyString(item)) return { ok: false, reason: 'non-string element' };
  }
  return { ok: true };
}

const VALID_ROLES: ScoringDetectedFile['role'][] = ['article', 'rubric', 'brief', 'other'];

/**
 * 硬校验。返回 { ok: false, errors } 时由调用方触发重试或整单失败退款。
 * 为什么 weight 和允许 [95,105]：GPT 偶尔 round 成 30/25/20/15/10 → 合 100；
 * 但有时会 33/25/20/15/8 → 合 101 这种小误差。不放行 100 之外就全废掉了。
 */
export function validateScoringJson(parsed: unknown): ScoringValidation {
  const errors: string[] = [];

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['response is not a JSON object'] };
  }
  const obj = parsed as Record<string, unknown>;

  if (!isIntegerInRange(obj.overall_score, 0, 100)) {
    errors.push('overall_score must be an integer in [0, 100]');
  }

  if (!isNonEmptyString(obj.overall_comment)) {
    errors.push('overall_comment must be a non-empty string');
  }

  const dimensionsRaw = obj.dimensions;
  if (!Array.isArray(dimensionsRaw) || dimensionsRaw.length < 1 || dimensionsRaw.length > 10) {
    errors.push('dimensions must be an array with 1..10 items');
  } else {
    let weightSum = 0;
    dimensionsRaw.forEach((dim, idx) => {
      if (!dim || typeof dim !== 'object') {
        errors.push(`dimensions[${idx}] must be an object`);
        return;
      }
      const d = dim as Record<string, unknown>;
      if (!isNonEmptyString(d.name)) errors.push(`dimensions[${idx}].name must be non-empty`);
      if (!isIntegerInRange(d.weight, 0, 100)) {
        errors.push(`dimensions[${idx}].weight must be integer in [0, 100]`);
      } else {
        weightSum += d.weight as number;
      }
      if (!isIntegerInRange(d.score, 0, 100)) {
        errors.push(`dimensions[${idx}].score must be integer in [0, 100]`);
      }
      const strengths = isStringArray(d.strengths, 1, 4);
      if (!strengths.ok) {
        errors.push(`dimensions[${idx}].strengths: ${strengths.reason}`);
      }
      // 允许 weaknesses 是 0 条也行，GPT 可以用 ["No substantive weaknesses identified."]
      const weaknesses = isStringArray(d.weaknesses, 0, 4);
      if (!weaknesses.ok) {
        errors.push(`dimensions[${idx}].weaknesses: ${weaknesses.reason}`);
      }
      const suggestions = isStringArray(d.suggestions, 1, 3);
      if (!suggestions.ok) {
        errors.push(`dimensions[${idx}].suggestions: ${suggestions.reason}`);
      }
    });
    // 权重和允许 [95, 105] 的容差（GPT round 产生的轻微误差）
    if (errors.length === 0 && (weightSum < 95 || weightSum > 105)) {
      errors.push(`dimension weights must sum to 100 (allow 95..105), got ${weightSum}`);
    }
  }

  const topSuggestions = isStringArray(obj.top_suggestions, 3, 6);
  if (!topSuggestions.ok) {
    errors.push(`top_suggestions: ${topSuggestions.reason}`);
  }

  const detectedRaw = obj.detected_files;
  if (!Array.isArray(detectedRaw) || detectedRaw.length === 0) {
    errors.push('detected_files must be a non-empty array');
  } else {
    detectedRaw.forEach((f, idx) => {
      if (!f || typeof f !== 'object') {
        errors.push(`detected_files[${idx}] must be an object`);
        return;
      }
      const file = f as Record<string, unknown>;
      if (!isNonEmptyString(file.filename)) {
        errors.push(`detected_files[${idx}].filename must be non-empty`);
      }
      if (
        typeof file.role !== 'string' ||
        !VALID_ROLES.includes(file.role as ScoringDetectedFile['role'])
      ) {
        errors.push(
          `detected_files[${idx}].role must be one of article/rubric/brief/other`,
        );
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, result: obj as unknown as ScoringResult };
}
