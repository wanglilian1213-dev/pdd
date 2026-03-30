import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { updateTaskStage, failTask } from './taskService';
import { getConfig } from './configService';
import { startWritingPipeline } from './writingService';
import {
  buildMaterialContentFromStorage,
  cleanupOpenAIFiles,
  type MaterialInputPart,
} from './materialInputService';
import {
  confirmOutlineTaskAtomic,
  releaseOutlineEditAtomic,
  reserveOutlineEditAtomic,
} from './atomicOpsService';
import { buildInitialOutlinePrompt, buildRegenerateOutlinePrompt, buildRepairOutlinePrompt } from './outlinePromptService';
import { buildMainOpenAIResponsesOptions } from '../lib/openaiMainConfig';
import { normalizeCitationStyle } from './citationStyleService';
import { validateTargetWords } from './requestValidationService';
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

interface ParsedOutlineResponse {
  paper_title: string;
  research_question: string;
  outline: string;
  target_words: number;
  citation_style: string;
}

export interface UsableOutlineResult {
  outlineContent: string;
  paperTitle: string;
  researchQuestion: string;
  targetWords: number;
  citationStyle: string;
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

async function repairOutlineBulletCounts(
  stage: 'outline_generation' | 'outline_regeneration',
  payload: ParsedOutlineResponse,
  options: {
    specialRequirements?: string | null;
    editInstruction?: string | null;
  },
) {
  return ensureValidOutlineBulletCounts(payload, async (currentPayload, violations) => {
    const prompt = buildRepairOutlinePrompt({
      currentOutline: currentPayload.outline,
      currentTargetWords: currentPayload.target_words,
      currentCitationStyle: currentPayload.citation_style,
      specialRequirements: options.specialRequirements,
      editInstruction: options.editInstruction,
      violationSummary: formatOutlineBulletViolations(violations),
    });

    const response = await openai.responses.create({
      ...buildMainOpenAIResponsesOptions(stage),
      input: [
        {
          role: 'system' as const,
          content: prompt.systemPrompt,
        },
        {
          role: 'user' as const,
          content: prompt.userPrompt,
        },
      ],
    });

    const repaired = parseOutlineJson(response.output_text, currentPayload);

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
  },
) {
  const assessment = assessOutlineReadiness(payload, {
    blockedFileTitles: options.fileNames,
  });

  if (assessment.valid) {
    return payload;
  }

  const prompt = buildRepairOutlinePrompt({
    currentOutline: payload.outline,
    currentPaperTitle: payload.paper_title,
    currentResearchQuestion: payload.research_question,
    currentTargetWords: payload.target_words,
    currentCitationStyle: payload.citation_style,
    specialRequirements: options.specialRequirements,
    editInstruction: options.editInstruction,
    violationSummary: 'None',
    qualityIssueSummary: assessment.reasons.join(', '),
  });

  const response = await openai.responses.create({
    ...buildMainOpenAIResponsesOptions(stage),
    input: [
      {
        role: 'system' as const,
        content: prompt.systemPrompt,
      },
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
  });

  const repaired = parseOutlineJson(response.output_text, payload);
  const repairedAssessment = assessOutlineReadiness(repaired, {
    blockedFileTitles: options.fileNames,
  });

  if (!repairedAssessment.valid) {
    throw new AppError(500, '大纲生成失败，请稍后重试。');
  }

  return repaired;
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
    const response = await openai.responses.create({
      ...buildMainOpenAIResponsesOptions('outline_generation'),
      input: [
        {
          role: 'system',
          content: prompt.systemPrompt,
        },
        {
          role: 'user',
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

    return parseCourseCodeExtraction(typeof response.output_text === 'string' ? response.output_text : '');
  } catch {
    return null;
  }
}

function sameOutlinePayload(left: ParsedOutlineResponse, right: ParsedOutlineResponse) {
  return (
    left.paper_title === right.paper_title &&
    left.research_question === right.research_question &&
    left.outline === right.outline &&
    left.target_words === right.target_words &&
    normalizeCitationStyle(left.citation_style) === normalizeCitationStyle(right.citation_style)
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

  let uploadedFileIds: string[] = [];
  try {
    const materialContent = await buildMaterialContentFromStorage(files);
    uploadedFileIds = materialContent.uploadedFileIds;

    const currentPayload: ParsedOutlineResponse = {
      paper_title: String(latestOutline.paper_title || task.paper_title || ''),
      research_question: String(latestOutline.research_question || task.research_question || ''),
      outline: String(latestOutline.content || ''),
      target_words: Number(latestOutline.target_words || task.target_words || 1000),
      citation_style: normalizeCitationStyle(String(latestOutline.citation_style || task.citation_style || 'APA 7')),
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
      },
    );

    const repaired = await repairOutlineReadiness(
      'outline_regeneration',
      bulletFixed,
      {
        specialRequirements: task.special_requirements,
        fileNames: files.map((file) => file.original_name),
        materialParts: materialContent.parts,
      },
    );

    const normalized: ParsedOutlineResponse = {
      paper_title: repaired.paper_title,
      research_question: repaired.research_question,
      outline: repaired.outline,
      target_words: repaired.target_words || currentPayload.target_words,
      citation_style: normalizeCitationStyle(repaired.citation_style || currentPayload.citation_style),
    };

    const needsNewOutlineVersion = !sameOutlinePayload(currentPayload, normalized);
    const needsTaskSync = (
      task.paper_title !== normalized.paper_title ||
      task.research_question !== normalized.research_question ||
      Number(task.target_words || 0) !== normalized.target_words ||
      normalizeCitationStyle(String(task.citation_style || 'APA 7')) !== normalized.citation_style ||
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
        target_words: normalized.target_words,
        citation_style: normalized.citation_style,
      });

      await supabaseAdmin.from('task_events').insert({
        task_id: taskId,
        event_type: 'outline_auto_repaired',
        detail: {
          paper_title: normalized.paper_title,
          research_question: normalized.research_question,
          target_words: normalized.target_words,
          citation_style: normalized.citation_style,
        },
      });
    }

    if (needsTaskSync) {
      await supabaseAdmin
        .from('tasks')
        .update({
          paper_title: normalized.paper_title,
          research_question: normalized.research_question,
          target_words: normalized.target_words,
          citation_style: normalized.citation_style,
          course_code: courseCode,
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);
    }

    return {
      outlineContent: normalized.outline,
      paperTitle: normalized.paper_title,
      researchQuestion: normalized.research_question,
      targetWords: normalized.target_words,
      citationStyle: normalized.citation_style,
      courseCode: courseCode || null,
    };
  } finally {
    await cleanupOpenAIFiles(uploadedFileIds);
  }
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

  let uploadedFileIds: string[] = [];
  try {
    const materialContent = await buildMaterialContentFromStorage(files);
    uploadedFileIds = materialContent.uploadedFileIds;
    const courseCode = await extractCourseCodeForTask({
      taskTitle: task?.title,
      specialRequirements: task?.special_requirements,
      existingCourseCode: task?.course_code,
      fileNames: files.map((file) => file.original_name),
      materialParts: materialContent.parts,
    });
    const prompt = buildInitialOutlinePrompt({
      specialRequirements: task?.special_requirements,
    });

    const response = await openai.responses.create({
      ...buildMainOpenAIResponsesOptions('outline_generation'),
      input: [
        {
          role: 'system' as const,
          content: prompt.systemPrompt,
        },
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
    });

    const content = response.output_text;

    const bulletFixed = await repairOutlineBulletCounts(
      'outline_generation',
      parseOutlineJson(content, {
        paper_title: '',
        research_question: '',
        outline: content,
        target_words: 1000,
        citation_style: 'APA 7',
      }),
      {
        specialRequirements: task?.special_requirements,
      },
    );
    const parsed = await repairOutlineReadiness(
      'outline_generation',
      bulletFixed,
      {
        specialRequirements: task?.special_requirements,
        fileNames: files.map((file) => file.original_name),
        materialParts: materialContent.parts,
      },
    );

    const targetWords = parsed.target_words || 1000;
    const citationStyle = normalizeCitationStyle(parsed.citation_style);

    const { data: outline, error } = await supabaseAdmin
      .from('outline_versions')
      .insert({
        task_id: taskId,
        version: 1,
        content: parsed.outline,
        paper_title: parsed.paper_title,
        research_question: parsed.research_question,
        target_words: targetWords,
        citation_style: citationStyle,
      })
      .select()
      .single();

    if (error) {
      throw new Error('保存大纲失败');
    }

    await updateTaskStage(taskId, 'outline_ready', {
      paper_title: parsed.paper_title,
      research_question: parsed.research_question,
      target_words: targetWords,
      citation_style: citationStyle,
      course_code: courseCode,
    });

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'outline_generated',
      detail: {
        version: 1,
        paper_title: parsed.paper_title,
        research_question: parsed.research_question,
        target_words: targetWords,
        citation_style: citationStyle,
      },
    });

    return outline;
  } catch (err: any) {
    const mappedError = mapOutlineGenerationError(err);
    await failTask(taskId, 'outline_generating', mappedError.userMessage, false);
    throw mappedError;
  } finally {
    await cleanupOpenAIFiles(uploadedFileIds);
  }
}

export async function regenerateOutline(taskId: string, userId: string, editInstruction: string) {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

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

  let reservedEdit = false;

  try {
    await reserveOutlineEditAtomic(taskId, userId, maxEdits);
    reservedEdit = true;

    const prompt = buildRegenerateOutlinePrompt({
      currentOutline: latestOutline.content,
      currentPaperTitle: latestOutline.paper_title,
      currentResearchQuestion: latestOutline.research_question,
      currentTargetWords: latestOutline.target_words,
      currentCitationStyle: latestOutline.citation_style,
      specialRequirements: task.special_requirements,
      editInstruction,
    });

    const response = await openai.responses.create({
      ...buildMainOpenAIResponsesOptions('outline_regeneration'),
      input: [
        {
          role: 'system' as const,
          content: prompt.systemPrompt,
        },
        {
          role: 'user' as const,
          content: prompt.userPrompt,
        },
      ],
    });

    const content = response.output_text;
    const bulletFixed = await repairOutlineBulletCounts(
      'outline_regeneration',
      parseOutlineJson(content, {
        paper_title: latestOutline.paper_title || '',
        research_question: latestOutline.research_question || '',
        outline: content,
        target_words: latestOutline.target_words,
        citation_style: latestOutline.citation_style,
      }),
      {
        specialRequirements: task.special_requirements,
        editInstruction,
      },
    );
    const parsed = await repairOutlineReadiness(
      'outline_regeneration',
      bulletFixed,
      {
        specialRequirements: task.special_requirements,
        editInstruction,
      },
    );

    const newVersion = latestOutline.version + 1;

    const { data: outline } = await supabaseAdmin
      .from('outline_versions')
      .insert({
        task_id: taskId,
        version: newVersion,
        content: parsed.outline,
        paper_title: parsed.paper_title,
        research_question: parsed.research_question,
        edit_instruction: editInstruction,
        target_words: parsed.target_words || latestOutline.target_words,
        citation_style: normalizeCitationStyle(parsed.citation_style || latestOutline.citation_style),
      })
      .select()
      .single();

    await supabaseAdmin
      .from('tasks')
      .update({
        paper_title: parsed.paper_title,
        research_question: parsed.research_question,
        target_words: parsed.target_words || latestOutline.target_words,
        citation_style: normalizeCitationStyle(parsed.citation_style || latestOutline.citation_style),
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    return outline;
  } catch (err: any) {
    if (reservedEdit) {
      await releaseOutlineEditAtomic(taskId, userId).catch(() => undefined);
    }
    if (err instanceof AppError) throw err;
    throw new AppError(500, '大纲修改失败，请稍后重试。');
  }
}

export async function confirmOutline(taskId: string, userId: string, targetWords?: number, citationStyle?: string) {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

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

  const finalWords = validateTargetWords(targetWords || latestOutline.target_words || 1000);
  const finalStyle = normalizeCitationStyle(citationStyle || latestOutline.citation_style || 'APA 7');

  const pricePerThousand = (await getConfig('writing_price_per_1000')) || 250;
  const units = Math.ceil(finalWords / 1000);
  const cost = units * pricePerThousand;

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
