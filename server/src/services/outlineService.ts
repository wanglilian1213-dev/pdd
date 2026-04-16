import { streamResponseText } from '../lib/openai';
import { callWithUpstreamRetry } from '../lib/upstreamRetry';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { updateTaskStage, failTask } from './taskService';
import { getConfig } from './configService';
import { startWritingPipeline } from './writingService';
import {
  getOrUploadMaterialContent,
  type MaterialInputPart,
} from './materialInputService';
import {
  confirmOutlineTaskAtomic,
  freezeCreditsAtomic,
  releaseOutlineEditAtomic,
  reserveOutlineEditAtomic,
  settleCreditsAtomic,
} from './atomicOpsService';
import { translateOutlineToZh } from './outlineTranslationService';
import {
  buildMergedOutlineGenerationPrompt,
  buildOutlineThemeReviewPrompt,
  buildRegenerateOutlinePrompt,
  buildRepairOutlinePrompt,
} from './outlinePromptService';
import { buildMainOpenAIResponsesOptions } from '../lib/openaiMainConfig';
import { normalizeCitationStyle } from './citationStyleService';
import { recordAuditLog } from './auditLogService';
import { captureError } from '../lib/errorMonitor';
import {
  buildCourseCodeExtractionPrompt,
  extractCourseCodeByRegex,
  parseCourseCodeExtraction,
} from './courseCodeService';
import { assessOutlineReadiness as assessOutlineReadinessInternal } from './paperQualityService';
import {
  ensureValidOutlineBulletCounts,
  formatOutlineBulletViolations,
} from './outlineStructureService';
import {
  deriveUnifiedTaskRequirements,
  normalizeExtractedTaskRequirements,
  parseRequirementOverrides,
  type UnifiedTaskRequirements,
} from './taskRequirementService';

interface ParsedOutlineResponse {
  paper_title: string;
  research_question: string;
  outline: string;
  target_words: number;
  citation_style: string;
}

interface OutlineThemeReviewResult {
  aligned: boolean;
  reason: string;
}

export interface UsableOutlineResult {
  outlineContent: string;
  paperTitle: string;
  researchQuestion: string;
  targetWords: number;
  citationStyle: string;
  requiredReferenceCount: number;
  requiredSectionCount: number;
  courseCode: string | null;
}

export const assessOutlineReadiness = assessOutlineReadinessInternal;

function parseOutlineJson(content: string, fallback: ParsedOutlineResponse): ParsedOutlineResponse {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content) as Partial<ParsedOutlineResponse>;
    return {
      paper_title: typeof parsed.paper_title === 'string' ? parsed.paper_title : fallback.paper_title,
      research_question: typeof parsed.research_question === 'string' ? parsed.research_question : fallback.research_question,
      outline: typeof parsed.outline === 'string' ? parsed.outline : fallback.outline,
      target_words: typeof parsed.target_words === 'number' ? parsed.target_words : fallback.target_words,
      citation_style: typeof parsed.citation_style === 'string' ? parsed.citation_style : fallback.citation_style,
    };
  } catch {
    return fallback;
  }
}

const THEME_REVIEW_PARSE_ERROR = 'theme_review_parse_error';

function parseOutlineThemeReview(content: string): OutlineThemeReviewResult {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content) as Partial<OutlineThemeReviewResult>;
    return {
      aligned: parsed.aligned === true,
      reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
    };
  } catch {
    return {
      aligned: false,
      reason: THEME_REVIEW_PARSE_ERROR,
    };
  }
}

function deriveStoredUnifiedRequirements(source: {
  target_words?: number | null;
  citation_style?: string | null;
  required_reference_count?: number | null;
  required_section_count?: number | null;
}) {
  const unified = deriveUnifiedTaskRequirements({
    targetWords: typeof source.target_words === 'number' ? source.target_words : undefined,
    citationStyle: typeof source.citation_style === 'string' ? source.citation_style : undefined,
    requiredSectionCount: typeof source.required_section_count === 'number' ? source.required_section_count : undefined,
    // DB 里存的 section count 已经过 merged prompt 阶段的 evidence 校验，这里是恢复场景，直接信任
    trustSectionCount: true,
  });

  return {
    targetWords: unified.targetWords,
    citationStyle: unified.citationStyle,
    requiredReferenceCount: Number(source.required_reference_count || unified.requiredReferenceCount),
    requiredSectionCount: unified.requiredSectionCount,
  };
}

async function repairOutlineBulletCounts(
  stage: 'outline_generation' | 'outline_regeneration',
  payload: ParsedOutlineResponse,
  options: {
    specialRequirements?: string | null;
    editInstruction?: string | null;
    requiredSectionCount: number;
    requiredReferenceCount: number;
  },
) {
  return ensureValidOutlineBulletCounts(payload, async (currentPayload, violations) => {
    const prompt = buildRepairOutlinePrompt({
      currentOutline: currentPayload.outline,
      currentTargetWords: currentPayload.target_words,
      currentCitationStyle: currentPayload.citation_style,
      requiredSectionCount: options.requiredSectionCount,
      requiredReferenceCount: options.requiredReferenceCount,
      specialRequirements: options.specialRequirements,
      editInstruction: options.editInstruction,
      violationSummary: formatOutlineBulletViolations(violations),
    });

    const { text: repairedText } = await callWithUpstreamRetry('outline_bullet_repair', () =>
      streamResponseText({
        ...buildMainOpenAIResponsesOptions(stage),
        instructions: prompt.systemPrompt,
        input: [
          {
            role: 'user' as const,
            content: prompt.userPrompt,
          },
        ],
      }), 2);

    const repaired = parseOutlineJson(repairedText, currentPayload);

    return {
      paper_title: repaired.paper_title || currentPayload.paper_title,
      research_question: repaired.research_question || currentPayload.research_question,
      outline: repaired.outline,
      target_words: repaired.target_words || currentPayload.target_words,
      citation_style: repaired.citation_style || currentPayload.citation_style,
    };
  });
}

async function repairOutlineReadiness(
  stage: 'outline_generation' | 'outline_regeneration',
  payload: ParsedOutlineResponse,
  options: {
    specialRequirements?: string | null;
    editInstruction?: string | null;
    fileNames?: string[];
    materialParts?: MaterialInputPart[];
    requiredSectionCount: number;
    requiredReferenceCount: number;
  },
) {
  const MAX_REPAIR_ATTEMPTS = 2;
  let current = payload;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const assessment = assessOutlineReadiness(current, {
      blockedFileTitles: options.fileNames,
      requiredSectionCount: options.requiredSectionCount,
    });

    if (assessment.valid) {
      return current;
    }

    console.log('[outline-repair] attempt', attempt, 'reasons:', assessment.reasons.join(', '), 'title:', current.paper_title);

    const prompt = buildRepairOutlinePrompt({
      currentOutline: current.outline,
      currentPaperTitle: current.paper_title,
      currentResearchQuestion: current.research_question,
      currentTargetWords: current.target_words,
      currentCitationStyle: current.citation_style,
      requiredSectionCount: options.requiredSectionCount,
      requiredReferenceCount: options.requiredReferenceCount,
      specialRequirements: options.specialRequirements,
      editInstruction: options.editInstruction,
      violationSummary: 'None',
      qualityIssueSummary: assessment.reasons.join(', '),
    });

    const { text: readinessText } = await callWithUpstreamRetry('outline_readiness_repair', () =>
      streamResponseText({
        ...buildMainOpenAIResponsesOptions(stage),
        instructions: prompt.systemPrompt,
        input: [
          {
            role: 'user' as const,
            content: options.materialParts
              ? [
                  {
                    type: 'input_text',
                    text: prompt.userPrompt,
                  },
                  ...options.materialParts,
                ]
              : prompt.userPrompt,
          },
        ],
      }), 2);

    current = parseOutlineJson(readinessText, current);
  }

  // Final check after all attempts
  const finalAssessment = assessOutlineReadiness(current, {
    blockedFileTitles: options.fileNames,
    requiredSectionCount: options.requiredSectionCount,
  });

  if (!finalAssessment.valid) {
    const detail = finalAssessment.reasons.join(', ');
    console.error('[outline-repair] still invalid after', MAX_REPAIR_ATTEMPTS, 'attempts:', detail, 'title:', current.paper_title);
    throw new AppError(500, '大纲生成失败，请稍后重试。', detail);
  }

  return current;
}

async function reviewOutlineThemeAlignment(
  stage: 'outline_generation' | 'outline_regeneration',
  payload: ParsedOutlineResponse,
  options: {
    specialRequirements?: string | null;
    materialParts?: MaterialInputPart[];
  },
) {
  if (!options.materialParts || options.materialParts.length === 0) {
    return {
      aligned: true,
      reason: 'no material files supplied for theme review',
    };
  }

  const prompt = buildOutlineThemeReviewPrompt({
    currentOutline: payload.outline,
    currentPaperTitle: payload.paper_title,
    currentResearchQuestion: payload.research_question,
    specialRequirements: options.specialRequirements,
  });

  const MAX_REVIEW_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_REVIEW_ATTEMPTS; attempt++) {
    const { text: reviewText } = await callWithUpstreamRetry('outline_theme_review', () =>
      streamResponseText({
        ...buildMainOpenAIResponsesOptions(stage),
        instructions: prompt.systemPrompt,
        input: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'input_text',
                text: prompt.userPrompt,
              },
              ...(options.materialParts ?? []),
            ],
          },
        ],
      }), 2);

    const result = parseOutlineThemeReview(reviewText);
    if (result.reason !== THEME_REVIEW_PARSE_ERROR) return result;
    console.warn(`[theme-review] parse failed on attempt ${attempt}/${MAX_REVIEW_ATTEMPTS}, raw:`, reviewText?.slice(0, 200));
  }

  // Two consecutive parse failures — default to aligned to avoid false-positive kills
  return { aligned: true, reason: 'parse failed twice, defaulting to aligned' };
}

async function repairOutlineThemeAlignment(
  stage: 'outline_generation' | 'outline_regeneration',
  payload: ParsedOutlineResponse,
  options: {
    specialRequirements?: string | null;
    editInstruction?: string | null;
    materialParts?: MaterialInputPart[];
    requiredSectionCount: number;
    requiredReferenceCount: number;
  },
) {
  const MAX_REPAIR_ATTEMPTS = 2;
  let current = payload;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const review = await reviewOutlineThemeAlignment(stage, current, {
      specialRequirements: options.specialRequirements,
      materialParts: options.materialParts,
    });

    if (review.aligned) return current;

    console.log('[theme-repair] attempt', attempt, 'reason:', review.reason, 'title:', current.paper_title);

    const prompt = buildRepairOutlinePrompt({
      currentOutline: current.outline,
      currentPaperTitle: current.paper_title,
      currentResearchQuestion: current.research_question,
      currentTargetWords: current.target_words,
      currentCitationStyle: current.citation_style,
      requiredSectionCount: options.requiredSectionCount,
      requiredReferenceCount: options.requiredReferenceCount,
      specialRequirements: options.specialRequirements,
      editInstruction: options.editInstruction,
      violationSummary: 'None',
      qualityIssueSummary: `Theme drift review failed: ${review.reason || 'The title, research question, and outline do not answer the actual task requirements.'}`,
    });

    const { text: repairedThemeText } = await callWithUpstreamRetry('outline_theme_repair', () =>
      streamResponseText({
        ...buildMainOpenAIResponsesOptions(stage),
        instructions: prompt.systemPrompt,
        input: [
          {
            role: 'user' as const,
            content: options.materialParts
              ? [
                  {
                    type: 'input_text',
                    text: prompt.userPrompt,
                  },
                  ...options.materialParts,
                ]
              : prompt.userPrompt,
          },
        ],
      }), 2);

    current = parseOutlineJson(repairedThemeText, current);
  }

  // Final check after all repair attempts
  const finalReview = await reviewOutlineThemeAlignment(stage, current, {
    specialRequirements: options.specialRequirements,
    materialParts: options.materialParts,
  });

  if (!finalReview.aligned) {
    console.error('[theme-repair] still misaligned after', MAX_REPAIR_ATTEMPTS, 'attempts:', finalReview.reason, 'title:', current.paper_title);
    throw new AppError(500, '大纲生成失败，请稍后重试。', finalReview.reason);
  }

  return current;
}

export function mapOutlineGenerationError(err: unknown) {
  if (err instanceof AppError) {
    return err;
  }

  const detail = err instanceof Error ? err.message : String(err || '');
  const normalized = detail.toLowerCase();

  if (
    normalized.includes('unsupported') ||
    normalized.includes('not supported') ||
    normalized.includes('invalid image') ||
    normalized.includes('does not represent a valid image') ||
    normalized.includes('invalid file') ||
    normalized.includes('failed to parse') ||
    normalized.includes('could not be processed')
  ) {
    return new AppError(
      400,
      'AI 接口暂时无法读取这个材料文件，请换一个常见格式，或先确认文件能正常打开后再试。',
      detail,
    );
  }

  if (
    normalized.includes('too large') ||
    normalized.includes('request too large') ||
    normalized.includes('maximum context') ||
    normalized.includes('context length')
  ) {
    return new AppError(
      400,
      '材料文件太大，AI 接口这次处理不了。请压缩文件，或拆成更小的几个文件后重试。',
      detail,
    );
  }

  if (
    normalized.includes('timed out') ||
    normalized.includes('timeout')
  ) {
    return new AppError(
      500,
      'AI 处理材料超时了，请稍后重试；如果文件很多，建议拆小一点再传。',
      detail,
    );
  }

  return new AppError(500, '大纲生成失败，请稍后重试。', detail);
}

async function extractCourseCodeForTask(options: {
  taskTitle?: string | null;
  specialRequirements?: string | null;
  existingCourseCode?: string | null;
  fileNames: string[];
  materialParts: MaterialInputPart[];
}) {
  if (options.existingCourseCode) {
    return options.existingCourseCode;
  }

  const regexResult = extractCourseCodeByRegex(
    options.taskTitle,
    options.specialRequirements,
    ...options.fileNames,
  );

  if (regexResult) {
    return regexResult;
  }

  const prompt = buildCourseCodeExtractionPrompt({
    taskTitle: options.taskTitle,
    specialRequirements: options.specialRequirements,
    fileNames: options.fileNames,
  });

  try {
    const { text: courseCodeText } = await streamResponseText({
      ...buildMainOpenAIResponsesOptions('outline_generation'),
      instructions: prompt.systemPrompt,
      input: [
        {
          role: 'user' as const,
          content: [
            {
              type: 'input_text',
              text: prompt.userPrompt,
            },
            ...options.materialParts,
          ],
        },
      ],
    });

    return parseCourseCodeExtraction(courseCodeText);
  } catch {
    return null;
  }
}

function sameOutlinePayload(
  left: ParsedOutlineResponse & { required_reference_count?: number; required_section_count?: number },
  right: ParsedOutlineResponse & { required_reference_count?: number; required_section_count?: number },
) {
  return (
    left.paper_title === right.paper_title &&
    left.research_question === right.research_question &&
    left.outline === right.outline &&
    left.target_words === right.target_words &&
    normalizeCitationStyle(left.citation_style) === normalizeCitationStyle(right.citation_style) &&
    Number(left.required_reference_count || 0) === Number(right.required_reference_count || 0) &&
    Number(left.required_section_count || 0) === Number(right.required_section_count || 0)
  );
}

export async function ensureUsableOutlineForTask(taskId: string): Promise<UsableOutlineResult> {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (!task) {
    throw new AppError(404, '任务不存在。');
  }

  const { data: latestOutline } = await supabaseAdmin
    .from('outline_versions')
    .select('*')
    .eq('task_id', taskId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (!latestOutline) {
    throw new AppError(404, '找不到可用大纲。');
  }

  const { data: files } = await supabaseAdmin
    .from('task_files')
    .select('original_name, storage_path, mime_type')
    .eq('task_id', taskId)
    .eq('category', 'material');

  if (!files || files.length === 0) {
    throw new AppError(400, '没有找到任务材料，无法修复大纲。');
  }

  const materialContent = await getOrUploadMaterialContent(taskId);
  const unifiedRequirements = deriveStoredUnifiedRequirements({
      target_words: typeof latestOutline.target_words === 'number' ? latestOutline.target_words : task.target_words,
      citation_style: typeof latestOutline.citation_style === 'string' ? latestOutline.citation_style : task.citation_style,
      required_reference_count: typeof latestOutline.required_reference_count === 'number'
        ? latestOutline.required_reference_count
        : task.required_reference_count,
      required_section_count: typeof latestOutline.required_section_count === 'number'
        ? latestOutline.required_section_count
        : task.required_section_count,
    });

    const currentPayload: ParsedOutlineResponse = {
      paper_title: String(latestOutline.paper_title || task.paper_title || ''),
      research_question: String(latestOutline.research_question || task.research_question || ''),
      outline: String(latestOutline.content || ''),
      target_words: unifiedRequirements.targetWords,
      citation_style: unifiedRequirements.citationStyle,
    };

    const courseCode = await extractCourseCodeForTask({
      taskTitle: task.title,
      specialRequirements: task.special_requirements,
      existingCourseCode: task.course_code,
      fileNames: files.map((file) => file.original_name),
      materialParts: materialContent.parts,
    });

    const bulletFixed = await repairOutlineBulletCounts(
      'outline_regeneration',
      currentPayload,
      {
        specialRequirements: task.special_requirements,
        requiredSectionCount: unifiedRequirements.requiredSectionCount,
        requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      },
    );

    const repaired = await repairOutlineReadiness(
      'outline_regeneration',
      bulletFixed,
      {
        specialRequirements: task.special_requirements,
        fileNames: files.map((file) => file.original_name),
        materialParts: materialContent.parts,
        requiredSectionCount: unifiedRequirements.requiredSectionCount,
        requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      },
    );
    const themeAligned = await repairOutlineThemeAlignment(
      'outline_regeneration',
      repaired,
      {
        specialRequirements: task.special_requirements,
        materialParts: materialContent.parts,
        requiredSectionCount: unifiedRequirements.requiredSectionCount,
        requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      },
    );

    const normalized: ParsedOutlineResponse = {
      paper_title: themeAligned.paper_title,
      research_question: themeAligned.research_question,
      outline: themeAligned.outline,
      target_words: unifiedRequirements.targetWords,
      citation_style: unifiedRequirements.citationStyle,
    };

    const needsNewOutlineVersion = !sameOutlinePayload(
      {
        ...currentPayload,
        required_reference_count: latestOutline.required_reference_count,
        required_section_count: latestOutline.required_section_count,
      },
      {
        ...normalized,
        required_reference_count: unifiedRequirements.requiredReferenceCount,
        required_section_count: unifiedRequirements.requiredSectionCount,
      },
    );
    const needsTaskSync = (
      task.paper_title !== normalized.paper_title ||
      task.research_question !== normalized.research_question ||
      Number(task.target_words || 0) !== unifiedRequirements.targetWords ||
      normalizeCitationStyle(String(task.citation_style || 'APA 7')) !== unifiedRequirements.citationStyle ||
      Number(task.required_reference_count || 0) !== unifiedRequirements.requiredReferenceCount ||
      Number(task.required_section_count || 0) !== unifiedRequirements.requiredSectionCount ||
      String(task.course_code || '') !== String(courseCode || '')
    );

    if (needsNewOutlineVersion) {
      await supabaseAdmin.from('outline_versions').insert({
        task_id: taskId,
        version: Number(latestOutline.version || 1) + 1,
        content: normalized.outline,
        paper_title: normalized.paper_title,
        research_question: normalized.research_question,
        edit_instruction: 'SYSTEM_AUTO_REPAIR',
        target_words: unifiedRequirements.targetWords,
        citation_style: unifiedRequirements.citationStyle,
        required_reference_count: unifiedRequirements.requiredReferenceCount,
        required_section_count: unifiedRequirements.requiredSectionCount,
      });

      await supabaseAdmin.from('task_events').insert({
        task_id: taskId,
        event_type: 'outline_auto_repaired',
        detail: {
          paper_title: normalized.paper_title,
          research_question: normalized.research_question,
          target_words: unifiedRequirements.targetWords,
          citation_style: unifiedRequirements.citationStyle,
          required_reference_count: unifiedRequirements.requiredReferenceCount,
          required_section_count: unifiedRequirements.requiredSectionCount,
        },
      });
    }

    if (needsTaskSync) {
      await supabaseAdmin
        .from('tasks')
        .update({
          paper_title: normalized.paper_title,
          research_question: normalized.research_question,
          target_words: unifiedRequirements.targetWords,
          citation_style: unifiedRequirements.citationStyle,
          required_reference_count: unifiedRequirements.requiredReferenceCount,
          required_section_count: unifiedRequirements.requiredSectionCount,
          course_code: courseCode,
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);
    }

    return {
      outlineContent: normalized.outline,
      paperTitle: normalized.paper_title,
      researchQuestion: normalized.research_question,
      targetWords: unifiedRequirements.targetWords,
      citationStyle: unifiedRequirements.citationStyle,
      requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      requiredSectionCount: unifiedRequirements.requiredSectionCount,
      courseCode: courseCode || null,
    };
}

export async function generateOutline(taskId: string, userId: string) {
  // 读取材料
  const { data: files } = await supabaseAdmin
    .from('task_files')
    .select('original_name, storage_path, mime_type')
    .eq('task_id', taskId)
    .eq('category', 'material');

  if (!files || files.length === 0) {
    await failTask(taskId, 'outline_generating', '没有找到上传的材料文件。', false);
    throw new AppError(400, '没有找到上传的材料文件，请重新创建任务。');
  }

  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('title, special_requirements, course_code')
    .eq('id', taskId)
    .single();

  await updateTaskStage(taskId, 'outline_generating');

  try {
    const materialContent = await getOrUploadMaterialContent(taskId);

    // Try regex course code extraction first (free, no API call)
    const regexCourseCode = extractCourseCodeByRegex(
      task?.title,
      task?.special_requirements,
      ...files.map((file) => file.original_name),
    ) || task?.course_code || null;

    // Single merged API call: GPT extracts requirements + course code + generates outline
    const prompt = buildMergedOutlineGenerationPrompt({
      specialRequirements: task?.special_requirements,
      knownCourseCode: regexCourseCode,
    });

    const { text: content } = await callWithUpstreamRetry('outline_generation', () =>
      streamResponseText({
        ...buildMainOpenAIResponsesOptions('outline_generation'),
        instructions: prompt.systemPrompt,
        input: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'input_text',
                text: prompt.userPrompt,
              },
              ...materialContent.parts,
            ],
          },
        ],
      }), 2);

    // Parse the merged response — extract requirements, course code, and outline
    const mergedJson = parseMergedOutlineResponse(content);
    // 注意：这里不传 trustSectionCount=true，走严格的 structureEvidence 白名单。
    // GPT 没提供合法 evidence 时，section count 会被回退为公式值，堵住 "1000 字返回 4 章" 这类自由发挥。
    const extractedRequirements = deriveUnifiedTaskRequirements(
      normalizeExtractedTaskRequirements(JSON.stringify({
        target_words: mergedJson.target_words,
        citation_style: mergedJson.citation_style,
        required_section_count: mergedJson.required_section_count,
        structure_evidence: mergedJson.structure_evidence ?? null,
      })),
    );

    const courseCode = regexCourseCode
      || parseCourseCodeExtraction(JSON.stringify({ course_code: mergedJson.course_code }))
      || null;

    const unifiedRequirements = extractedRequirements;

    const bulletFixed = await repairOutlineBulletCounts(
      'outline_generation',
      parseOutlineJson(content, {
        paper_title: mergedJson.paper_title || '',
        research_question: mergedJson.research_question || '',
        outline: mergedJson.outline || content,
        target_words: unifiedRequirements.targetWords,
        citation_style: unifiedRequirements.citationStyle,
      }),
      {
        specialRequirements: task?.special_requirements,
        requiredSectionCount: unifiedRequirements.requiredSectionCount,
        requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      },
    );
    const parsed = await repairOutlineReadiness(
      'outline_generation',
      bulletFixed,
      {
        specialRequirements: task?.special_requirements,
        fileNames: files.map((file) => file.original_name),
        materialParts: materialContent.parts,
        requiredSectionCount: unifiedRequirements.requiredSectionCount,
        requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      },
    );
    const themeAligned = await repairOutlineThemeAlignment(
      'outline_generation',
      parsed,
      {
        specialRequirements: task?.special_requirements,
        materialParts: materialContent.parts,
        requiredSectionCount: unifiedRequirements.requiredSectionCount,
        requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      },
    );

    const contentZh = await translateOutlineToZh(themeAligned.outline);

    const { data: outline, error } = await supabaseAdmin
      .from('outline_versions')
      .insert({
        task_id: taskId,
        version: 1,
        content: themeAligned.outline,
        content_zh: contentZh,
        paper_title: themeAligned.paper_title,
        research_question: themeAligned.research_question,
        target_words: unifiedRequirements.targetWords,
        citation_style: unifiedRequirements.citationStyle,
        required_reference_count: unifiedRequirements.requiredReferenceCount,
        required_section_count: unifiedRequirements.requiredSectionCount,
      })
      .select()
      .single();

    if (error) {
      throw new Error('保存大纲失败');
    }

    await updateTaskStage(taskId, 'outline_ready', {
      paper_title: themeAligned.paper_title,
      research_question: themeAligned.research_question,
      target_words: unifiedRequirements.targetWords,
      citation_style: unifiedRequirements.citationStyle,
      required_reference_count: unifiedRequirements.requiredReferenceCount,
      required_section_count: unifiedRequirements.requiredSectionCount,
      course_code: courseCode,
    });

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'outline_generated',
      detail: {
        version: 1,
        paper_title: themeAligned.paper_title,
        research_question: themeAligned.research_question,
        target_words: unifiedRequirements.targetWords,
        citation_style: unifiedRequirements.citationStyle,
        required_reference_count: unifiedRequirements.requiredReferenceCount,
        required_section_count: unifiedRequirements.requiredSectionCount,
      },
    });

    return outline;
  } catch (err: any) {
    const mappedError = mapOutlineGenerationError(err);
    const techDetail = err instanceof Error ? `${err.name}: ${err.message}` : String(err || '');
    await failTask(taskId, 'outline_generating', mappedError.userMessage, false, techDetail);
    throw mappedError;
  }
  // No finally cleanup — files are reused across stages and cleaned up on task completion/failure
}

interface MergedOutlineJson {
  course_code?: string | null;
  target_words?: number | null;
  citation_style?: string | null;
  required_section_count?: number | null;
  structure_evidence?: string | null;
  paper_title: string;
  research_question: string;
  outline: string;
}

function parseMergedOutlineResponse(content: string): MergedOutlineJson {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content) as Partial<MergedOutlineJson>;
    return {
      course_code: typeof parsed.course_code === 'string' ? parsed.course_code : null,
      target_words: typeof parsed.target_words === 'number' ? parsed.target_words : null,
      citation_style: typeof parsed.citation_style === 'string' ? parsed.citation_style : null,
      required_section_count: typeof parsed.required_section_count === 'number' ? parsed.required_section_count : null,
      structure_evidence: typeof parsed.structure_evidence === 'string' ? parsed.structure_evidence : null,
      paper_title: typeof parsed.paper_title === 'string' ? parsed.paper_title : '',
      research_question: typeof parsed.research_question === 'string' ? parsed.research_question : '',
      outline: typeof parsed.outline === 'string' ? parsed.outline : content,
    };
  } catch {
    return {
      course_code: null,
      target_words: null,
      citation_style: null,
      required_section_count: null,
      structure_evidence: null,
      paper_title: '',
      research_question: '',
      outline: content,
    };
  }
}

export async function regenerateOutline(taskId: string, userId: string, editInstruction: string) {
  const { data: task, error: taskError } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (taskError) {
    if (taskError.code === 'PGRST116') {
      throw new AppError(404, '任务不存在。');
    }
    console.error(`[regenerateOutline] task query failed task=${taskId} user=${userId}`, taskError);
    throw new AppError(500, '查询任务失败，请稍后重试。');
  }
  if (!task) {
    throw new AppError(404, '任务不存在。');
  }
  if (task.stage !== 'outline_ready') {
    throw new AppError(400, '当前阶段无法修改大纲。');
  }

  const maxEdits = (await getConfig('max_outline_edits')) || 4;

  const { data: latestOutline } = await supabaseAdmin
    .from('outline_versions')
    .select('*')
    .eq('task_id', taskId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (!latestOutline) {
    throw new AppError(500, '找不到当前大纲。');
  }

  const { data: files } = await supabaseAdmin
    .from('task_files')
    .select('original_name, storage_path, mime_type')
    .eq('task_id', taskId)
    .eq('category', 'material');

  if (!files || files.length === 0) {
    throw new AppError(400, '没有找到任务材料，无法修改大纲。');
  }

  let reservedEdit = false;

  try {
    // Pre-check balance before starting expensive OpenAI work
    const editCost = (await getConfig('outline_edit_cost')) || 50;
    const { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();
    if (!wallet || wallet.balance < editCost) {
      throw new AppError(400, '余额不足，请先充值后再操作。');
    }

    // Reserve edit slot + lock task stage to 'outline_regenerating' (blocks concurrent requests)
    await reserveOutlineEditAtomic(taskId, userId, maxEdits);
    reservedEdit = true;

    const materialContent = await getOrUploadMaterialContent(taskId);

    // Parse requirement overrides from user's editInstruction (e.g. "写3000字", "换成Harvard")
    const overrides = parseRequirementOverrides(editInstruction);
    const baseTargetWords = typeof latestOutline.target_words === 'number' ? latestOutline.target_words : task.target_words;
    const baseCitationStyle = typeof latestOutline.citation_style === 'string' ? latestOutline.citation_style : task.citation_style;
    const hasOverride = overrides.targetWords !== undefined || overrides.citationStyle !== undefined || overrides.requiredSectionCount !== undefined;

    // When user overrides section count, use it directly.
    // When user only changes citation style (not word count), preserve stored section count.
    // When user changes word count, let the formula recalculate.
    const sectionCountForOverride = overrides.requiredSectionCount
      ?? (overrides.targetWords === undefined
        ? (typeof latestOutline.required_section_count === 'number'
          ? latestOutline.required_section_count
          : typeof task.required_section_count === 'number'
            ? task.required_section_count
            : undefined)
        : undefined);

    const unifiedRequirements = hasOverride
      ? deriveUnifiedTaskRequirements({
          targetWords: overrides.targetWords ?? baseTargetWords,
          citationStyle: overrides.citationStyle ?? baseCitationStyle,
          requiredSectionCount: sectionCountForOverride,
          // 用户手动 override（"改成 6 章"）或已落库的 section count 是可信来源，跳过 evidence 校验
          trustSectionCount: true,
        })
      : deriveStoredUnifiedRequirements({
          target_words: baseTargetWords,
          citation_style: baseCitationStyle,
          required_reference_count: typeof latestOutline.required_reference_count === 'number'
            ? latestOutline.required_reference_count
            : task.required_reference_count,
          required_section_count: typeof latestOutline.required_section_count === 'number'
            ? latestOutline.required_section_count
            : task.required_section_count,
        });

    const prompt = buildRegenerateOutlinePrompt({
      currentOutline: latestOutline.content,
      currentPaperTitle: latestOutline.paper_title,
      currentResearchQuestion: latestOutline.research_question,
      currentTargetWords: unifiedRequirements.targetWords,
      currentCitationStyle: unifiedRequirements.citationStyle,
      requiredSectionCount: unifiedRequirements.requiredSectionCount,
      requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      specialRequirements: task.special_requirements,
      editInstruction,
    });

    const { text: content } = await callWithUpstreamRetry('outline_regeneration', () =>
      streamResponseText({
        ...buildMainOpenAIResponsesOptions('outline_regeneration'),
        instructions: prompt.systemPrompt,
        input: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'input_text',
                text: prompt.userPrompt,
              },
              ...materialContent.parts,
            ],
          },
        ],
      }), 2);
    const bulletFixed = await repairOutlineBulletCounts(
      'outline_regeneration',
      parseOutlineJson(content, {
        paper_title: latestOutline.paper_title || '',
        research_question: latestOutline.research_question || '',
        outline: content,
        target_words: unifiedRequirements.targetWords,
        citation_style: unifiedRequirements.citationStyle,
      }),
      {
        specialRequirements: task.special_requirements,
        editInstruction,
        requiredSectionCount: unifiedRequirements.requiredSectionCount,
        requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      },
    );
    const parsed = await repairOutlineReadiness(
      'outline_regeneration',
      bulletFixed,
      {
        specialRequirements: task.special_requirements,
        editInstruction,
        fileNames: files.map((file) => file.original_name),
        materialParts: materialContent.parts,
        requiredSectionCount: unifiedRequirements.requiredSectionCount,
        requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      },
    );
    const themeAligned = await repairOutlineThemeAlignment(
      'outline_regeneration',
      parsed,
      {
        specialRequirements: task.special_requirements,
        editInstruction,
        materialParts: materialContent.parts,
        requiredSectionCount: unifiedRequirements.requiredSectionCount,
        requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      },
    );

    const contentZh = await translateOutlineToZh(themeAligned.outline);

    const newVersion = latestOutline.version + 1;

    const { data: outline, error: insertError } = await supabaseAdmin
      .from('outline_versions')
      .insert({
        task_id: taskId,
        version: newVersion,
        content: themeAligned.outline,
        content_zh: contentZh,
        paper_title: themeAligned.paper_title,
        research_question: themeAligned.research_question,
        edit_instruction: editInstruction,
        target_words: unifiedRequirements.targetWords,
        citation_style: unifiedRequirements.citationStyle,
        required_reference_count: unifiedRequirements.requiredReferenceCount,
        required_section_count: unifiedRequirements.requiredSectionCount,
      })
      .select()
      .single();

    if (insertError || !outline) {
      throw new Error(`保存大纲版本失败: ${insertError?.message || 'no data returned'}`);
    }

    const { error: updateError } = await supabaseAdmin
      .from('tasks')
      .update({
        stage: 'outline_ready',
        paper_title: themeAligned.paper_title,
        research_question: themeAligned.research_question,
        target_words: unifiedRequirements.targetWords,
        citation_style: unifiedRequirements.citationStyle,
        required_reference_count: unifiedRequirements.requiredReferenceCount,
        required_section_count: unifiedRequirements.requiredSectionCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    if (updateError) {
      throw new Error(`更新任务元数据失败: ${updateError.message}`);
    }

    // Deduct credits AFTER outline is durably saved (deferred billing: safe against crashes)
    await freezeCreditsAtomic(userId, editCost, 'task', taskId, `大纲修改（第 ${newVersion} 版），${editCost} 积分`);
    await settleCreditsAtomic(userId, editCost);

    // reservedEdit is consumed — stage was restored to outline_ready by tasks.update above
    reservedEdit = false;

    return outline;
  } catch (err: any) {
    if (reservedEdit) {
      await releaseOutlineEditAtomic(taskId, userId).catch(() => undefined);
    }
    if (err instanceof AppError) throw err;
    throw new AppError(500, '大纲修改失败，请稍后重试。');
  }
  // No finally cleanup — files are reused across stages and cleaned up on task completion/failure
}

export async function confirmOutline(taskId: string, userId: string) {
  const { data: task, error: taskError } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (taskError) {
    if (taskError.code === 'PGRST116') {
      throw new AppError(404, '任务不存在。');
    }
    console.error(`[confirmOutline] task query failed task=${taskId} user=${userId}`, taskError);
    throw new AppError(500, '查询任务失败，请稍后重试。');
  }
  if (!task) throw new AppError(404, '任务不存在。');
  if (task.stage !== 'outline_ready') throw new AppError(400, '请先等待大纲生成完成。');

  const { data: latestOutline } = await supabaseAdmin
    .from('outline_versions')
    .select('*')
    .eq('task_id', taskId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (!latestOutline) throw new AppError(500, '找不到大纲。');

  const finalWords = Number(latestOutline.target_words || task.target_words || 1000);
  const finalStyle = normalizeCitationStyle(String(latestOutline.citation_style || task.citation_style || 'APA 7'));

  // 按字精确计费：cost = ceil(字数 × 单价)
  // configService 把字符串型小数原样返回，这里统一 Number()。
  const rawPrice = await getConfig('writing_price_per_word');
  const pricePerWord = (typeof rawPrice === 'number' ? rawPrice : Number(rawPrice)) || 0.1;
  const cost = Math.ceil(finalWords * pricePerWord);

  const result = await confirmOutlineTaskAtomic(taskId, userId, finalWords, finalStyle, cost);

  await recordAuditLog({
    actorUserId: userId,
    action: 'outline.confirmed',
    targetType: 'task',
    targetId: taskId,
    detail: {
      targetWords: finalWords,
      citationStyle: finalStyle,
      frozenCredits: result.frozenCredits,
    },
  });

  // Fire-and-forget: start the writing pipeline asynchronously
  startWritingPipeline(taskId, userId).catch(err => {
    captureError(err, 'outline.start_writing_pipeline', { taskId, userId });
  });

  return result;
}
