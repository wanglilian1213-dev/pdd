import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { updateTaskStage, failTask, completeTask } from './taskService';
import { settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import { buildMainOpenAIResponsesOptions } from '../lib/openaiMainConfig';
import { buildFormattedPaperDocBuffer } from './documentFormattingService';
import { buildDocxFileName, normalizeDeliveryPaperTitle } from './paperTitleService';
import { buildMaterialContentFromStorage, cleanupOpenAIFiles, type StoredMaterialFile } from './materialInputService';
import { assessGeneratedPaper as assessGeneratedPaperInternal } from './paperQualityService';
import {
  buildCitationReportPrompt,
  parseCitationReportData,
  renderCitationReportPdf,
} from './citationReportTemplateService';

export const assessGeneratedPaper = assessGeneratedPaperInternal;

interface WritingContextInput {
  taskId: string;
  materialFiles: StoredMaterialFile[];
  outline: string;
  paperTitle: string;
  researchQuestion: string;
  targetWords: number;
  citationStyle: string;
  requirements: string;
  courseCode?: string | null;
  versionBase?: number;
}

interface GeneratedTaskFilePayload {
  taskId: string;
  category: 'final_doc' | 'citation_report' | 'humanized_doc';
  originalName: string;
  storagePath: string;
  fileSize: number;
  mimeType: string;
  expiresAtIso: string;
  body: Buffer;
}

interface StoreGeneratedTaskFileDeps {
  uploadToStorage: (
    storagePath: string,
    body: Buffer,
    mimeType: string,
  ) => Promise<{ error: Error | null }>;
  insertTaskFileRecord: (record: {
    task_id: string;
    category: 'final_doc' | 'citation_report' | 'humanized_doc';
    original_name: string;
    storage_path: string;
    file_size: number;
    mime_type: string;
    expires_at: string;
  }) => Promise<{ error: Error | null }>;
  removeFromStorage: (storagePath: string) => Promise<void>;
}

export async function storeGeneratedTaskFile(
  payload: GeneratedTaskFilePayload,
  deps: StoreGeneratedTaskFileDeps = {
    uploadToStorage: async (storagePath, body, mimeType) => {
      const { error } = await supabaseAdmin.storage
        .from('task-files')
        .upload(storagePath, body, { contentType: mimeType });
      return { error: error ? new Error(error.message) : null };
    },
    insertTaskFileRecord: async (record) => {
      const { error } = await supabaseAdmin.from('task_files').insert(record);
      return { error: error ? new Error(error.message) : null };
    },
    removeFromStorage: async (storagePath) => {
      await supabaseAdmin.storage.from('task-files').remove([storagePath]);
    },
  },
) {
  const uploadResult = await deps.uploadToStorage(payload.storagePath, payload.body, payload.mimeType);
  if (uploadResult.error) {
    throw uploadResult.error;
  }

  const insertResult = await deps.insertTaskFileRecord({
    task_id: payload.taskId,
    category: payload.category,
    original_name: payload.originalName,
    storage_path: payload.storagePath,
    file_size: payload.fileSize,
    mime_type: payload.mimeType,
    expires_at: payload.expiresAtIso,
  });

  if (insertResult.error) {
    await deps.removeFromStorage(payload.storagePath).catch(() => undefined);
    throw insertResult.error;
  }
}

export async function startWritingPipeline(taskId: string, userId: string) {
  try {
    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (!task) throw new Error('Task not found');

    const { data: latestOutline } = await supabaseAdmin
      .from('outline_versions')
      .select('*')
      .eq('task_id', taskId)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    const { data: materialFiles } = await supabaseAdmin
      .from('task_files')
      .select('original_name, storage_path, mime_type')
      .eq('task_id', taskId)
      .eq('category', 'material');

    if (!latestOutline) throw new Error('Outline not found');
    if (!materialFiles || materialFiles.length === 0) throw new Error('Material files not found');

    const paperTitle = String(latestOutline.paper_title || task.paper_title || task.title || '').trim();
    const researchQuestion = String(latestOutline.research_question || task.research_question || '').trim();
    const versionBase = await getDocumentVersionBase(taskId);

    // Step 1: Draft
    await updateTaskStage(taskId, 'writing');
    const draft = await generateDraft({
      taskId,
      materialFiles: materialFiles as StoredMaterialFile[],
      outline: latestOutline.content,
      paperTitle,
      researchQuestion,
      targetWords: task.target_words,
      citationStyle: task.citation_style,
      requirements: task.special_requirements,
      versionBase,
    });

    // Step 2: Calibrate
    await updateTaskStage(taskId, 'word_calibrating');
    const calibrated = await calibrateWordCount(taskId, draft, task.target_words, versionBase);

    // Step 3: Citation check
    await updateTaskStage(taskId, 'citation_checking');
    const verified = await verifyCitations(taskId, calibrated, task.citation_style, versionBase);

    // Step 4: Deliver
    await updateTaskStage(taskId, 'delivering');
    await deliverResults(taskId, userId, verified, task, versionBase);

    // Success: settle
    await settleCredits(userId, task.frozen_credits);
    await completeTask(taskId);

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'writing_completed',
      detail: { frozen_credits: task.frozen_credits },
    });

  } catch (err: any) {
    console.error(`Writing pipeline failed for task ${taskId}:`, err);

    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('user_id, frozen_credits, stage')
      .eq('id', taskId)
      .single();

    if (task && task.frozen_credits > 0) {
      try {
        await refundCredits(task.user_id, task.frozen_credits, 'task', taskId, `正文生成失败退款：${task.frozen_credits} 积分`);
        await failTask(taskId, task.stage, '正文生成过程中出现问题，积分已自动退回。请重新创建任务。', true);
      } catch (refundErr) {
        console.error(`Refund failed for task ${taskId}:`, refundErr);
        await failTask(taskId, task.stage, '正文生成失败，退款异常，请联系客服处理。', false);
      }
    } else {
      await failTask(taskId, 'writing', '正文生成失败。', false);
    }
  }
}

async function getDocumentVersionBase(taskId: string) {
  const { data } = await supabaseAdmin
    .from('document_versions')
    .select('version')
    .eq('task_id', taskId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  return typeof data?.version === 'number' ? data.version : 0;
}

export function buildDraftGenerationSystemPrompt(targetWords: number, citationStyle: string) {
  return `You are an academic writing expert.

Write the entire article at once.
Write all chapters from the provided outline.
The target word count is approximately ${targetWords} words.
Use ${citationStyle} citation style.
Write only the paper content, with no meta-commentary.
Include proper in-text citations and a references section.

The reasoning effort should be high.
Think very hard and deep.
Make sure the answer is detailed, specific, and comprehensive.
Cut off all shallow talk.

Write in paragraphs, no bullet point.
This must be a critical argumentative discussion.
The discussion must point to an argument that corresponds with the thesis statement.
Always provide specific detailed evidence to support your critical argument.
Add strong critical academic thinking.
You should take a clear stand but write in third person.
You should pick a side and have strong academic opinions but write in third person while you must keep it critical.
Go beyond identifying and describing by analyzing, considering multiple viewpoints, and building more cogent arguments.

Think step by step to re-structure the expression in sentences.
Avoid using the Chinese pattern “不是…而是..”.
Do not change any meaning.
Do not miss any information.

Do not use straight quotation marks.
Do not use em dash.
Do not use a dependent clause followed by an independent clause separated with a comma.
Do not use Markdown syntax, Markdown emphasis markers, Markdown headings, backticks, or Markdown list markers.
Return clean academic prose only.

each references should come with proper link.`;
}

export function buildWordCalibrationSystemPrompt(currentWords: number, targetWords: number) {
  return `You are an academic writing editor. The current paper has ${currentWords} words but the target is ${targetWords} words. ${currentWords < targetWords ? 'Expand' : 'Condense'} the paper to approximately ${targetWords} words while maintaining quality and coherence. Output only the revised paper.
Do not use Markdown syntax, Markdown emphasis markers, Markdown headings, backticks, or Markdown list markers.
Return clean academic prose only.`;
}

export function buildCitationVerificationSystemPrompt(citationStyle: string) {
  return `You are a citation verification expert. Review the paper and ensure all citations follow ${citationStyle} format. Fix any formatting issues. Output the corrected paper text only.
Do not use Markdown syntax, Markdown emphasis markers, Markdown headings, backticks, or Markdown list markers.
Return clean academic prose only.`;
}

function buildDraftGenerationUserPrompt(options: {
  paperTitle: string;
  researchQuestion: string;
  outline: string;
  requirements: string;
}) {
  return `Paper title:
${options.paperTitle}

Research question:
${options.researchQuestion}

Outline:
${options.outline}

Additional requirements:
${options.requirements || 'None'}

Use the attached material files directly. Write a complete academic paper that answers the research question, follows the title and outline, includes real in-text citations, and ends with a real references section.`;
}

function buildDraftRepairUserPrompt(options: {
  paperTitle: string;
  researchQuestion: string;
  outline: string;
  requirements: string;
  badDraft: string;
  reasons: string[];
}) {
  return `The previous draft is not deliverable and must be repaired.

Why it is not deliverable:
${options.reasons.join(', ')}

Paper title:
${options.paperTitle}

Research question:
${options.researchQuestion}

Outline:
${options.outline}

Additional requirements:
${options.requirements || 'None'}

Previous bad draft:
${options.badDraft}

Use the attached material files directly. Rewrite the full paper so it becomes a deliverable academic article with real in-text citations and a non-empty references section.`;
}

function buildStageRepairUserPrompt(options: {
  lastGoodText: string;
  brokenText: string;
  reasons: string[];
  stage: 'word_calibration' | 'citation_verification';
}) {
  return `The latest ${options.stage === 'word_calibration' ? 'word calibration' : 'citation verification'} rewrite became unusable.

Why it is not deliverable:
${options.reasons.join(', ')}

Use the last acceptable paper below as the base version. Keep its meaning, keep its citations and references, and return one fully deliverable paper.

Last acceptable paper:
${options.lastGoodText}

Broken rewrite to avoid:
${options.brokenText}`;
}

async function generateDraft(input: WritingContextInput): Promise<string> {
  const materialContent = await buildMaterialContentFromStorage(input.materialFiles);

  try {
    const response = await openai.responses.create({
      ...buildMainOpenAIResponsesOptions('draft_generation'),
      input: [
        {
          role: 'system',
          content: buildDraftGenerationSystemPrompt(input.targetWords, input.citationStyle),
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: buildDraftGenerationUserPrompt({
                paperTitle: input.paperTitle,
                researchQuestion: input.researchQuestion,
                outline: input.outline,
                requirements: input.requirements,
              }),
            },
            ...materialContent.parts,
          ],
        },
      ],
    });

    let content = typeof response.output_text === 'string' ? response.output_text : '';
    let assessment = assessGeneratedPaper(content);

    if (!assessment.valid) {
      const repairedResponse = await openai.responses.create({
        ...buildMainOpenAIResponsesOptions('draft_generation'),
        input: [
          {
            role: 'system',
            content: buildDraftGenerationSystemPrompt(input.targetWords, input.citationStyle),
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: buildDraftRepairUserPrompt({
                  paperTitle: input.paperTitle,
                  researchQuestion: input.researchQuestion,
                  outline: input.outline,
                  requirements: input.requirements,
                  badDraft: content,
                  reasons: assessment.reasons,
                }),
              },
              ...materialContent.parts,
            ],
          },
        ],
      });

      content = typeof repairedResponse.output_text === 'string' ? repairedResponse.output_text : content;
      assessment = assessGeneratedPaper(content);
      if (!assessment.valid) {
        throw new Error(`draft_invalid:${assessment.reasons.join(',')}`);
      }
    }

    const wordCount = content.split(/\s+/).filter(Boolean).length;

    await supabaseAdmin.from('document_versions').insert({
      task_id: input.taskId,
      version: (input.versionBase || 0) + 1,
      stage: 'draft',
      word_count: wordCount,
      content,
    });

    await supabaseAdmin.from('task_events').insert({
      task_id: input.taskId,
      event_type: 'draft_generated',
      detail: { word_count: wordCount, paper_title: input.paperTitle, research_question: input.researchQuestion },
    });

    return content;
  } finally {
    await cleanupOpenAIFiles(materialContent.uploadedFileIds);
  }
}

async function calibrateWordCount(taskId: string, draft: string, targetWords: number, versionBase = 0): Promise<string> {
  const currentWords = draft.split(/\s+/).filter(Boolean).length;
  const tolerance = 0.1;

  if (Math.abs(currentWords - targetWords) / targetWords <= tolerance) {
    await supabaseAdmin.from('document_versions').insert({
      task_id: taskId,
      version: versionBase + 2,
      stage: 'calibrated',
      word_count: currentWords,
      content: draft,
    });
    return draft;
  }

  const response = await openai.responses.create({
    ...buildMainOpenAIResponsesOptions('word_calibration'),
    input: [
      {
        role: 'system',
        content: buildWordCalibrationSystemPrompt(currentWords, targetWords),
      },
      {
        role: 'user',
        content: draft,
      },
    ],
  });

  let calibrated = typeof response.output_text === 'string' ? response.output_text : draft;
  let assessment = assessGeneratedPaper(calibrated);

  if (!assessment.valid) {
    const repairedResponse = await openai.responses.create({
      ...buildMainOpenAIResponsesOptions('word_calibration'),
      input: [
        {
          role: 'system',
          content: buildWordCalibrationSystemPrompt(currentWords, targetWords),
        },
        {
          role: 'user',
          content: buildStageRepairUserPrompt({
            lastGoodText: draft,
            brokenText: calibrated,
            reasons: assessment.reasons,
            stage: 'word_calibration',
          }),
        },
      ],
    });

    const repaired = typeof repairedResponse.output_text === 'string' ? repairedResponse.output_text : draft;
    assessment = assessGeneratedPaper(repaired);
    calibrated = assessment.valid ? repaired : draft;
  }

  const newWordCount = calibrated.split(/\s+/).filter(Boolean).length;

  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: versionBase + 2,
    stage: 'calibrated',
    word_count: newWordCount,
    content: calibrated,
  });

  return calibrated;
}

async function verifyCitations(taskId: string, text: string, citationStyle: string, versionBase = 0): Promise<string> {
  const response = await openai.responses.create({
    ...buildMainOpenAIResponsesOptions('citation_verification'),
    input: [
      {
        role: 'system',
        content: buildCitationVerificationSystemPrompt(citationStyle),
      },
      {
        role: 'user',
        content: text,
      },
    ],
  });

  let verified = typeof response.output_text === 'string' ? response.output_text : text;
  let assessment = assessGeneratedPaper(verified);

  if (!assessment.valid) {
    const repairedResponse = await openai.responses.create({
      ...buildMainOpenAIResponsesOptions('citation_verification'),
      input: [
        {
          role: 'system',
          content: buildCitationVerificationSystemPrompt(citationStyle),
        },
        {
          role: 'user',
          content: buildStageRepairUserPrompt({
            lastGoodText: text,
            brokenText: verified,
            reasons: assessment.reasons,
            stage: 'citation_verification',
          }),
        },
      ],
    });

    const repaired = typeof repairedResponse.output_text === 'string' ? repairedResponse.output_text : text;
    assessment = assessGeneratedPaper(repaired);
    verified = assessment.valid ? repaired : text;
  }

  const wordCount = verified.split(/\s+/).filter(Boolean).length;

  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: versionBase + 3,
    stage: 'verified',
    word_count: wordCount,
    content: verified,
  });

  return verified;
}

async function deliverResults(taskId: string, userId: string, finalText: string, task: any, versionBase = 0) {
  const wordCount = finalText.split(/\s+/).filter(Boolean).length;
  const retentionDays = (await getConfig('result_file_retention_days')) || 3;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + retentionDays);
  const displayTitle = normalizeDeliveryPaperTitle(task.paper_title || task.title, 'Academic Essay');

  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: versionBase + 4,
    stage: 'final',
    word_count: wordCount,
    content: finalText,
  });

  const docBuffer = await buildFormattedPaperDocBuffer(finalText, {
    paperTitle: displayTitle,
    courseCode: task.course_code,
  });
  const finalDocName = buildDocxFileName(task.paper_title || task.title, 'Academic Essay');
  const docPath = `${taskId}/${finalDocName}`;

  await storeGeneratedTaskFile({
    taskId,
    category: 'final_doc',
    originalName: finalDocName,
    storagePath: docPath,
    fileSize: docBuffer.length,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    expiresAtIso: expiresAt.toISOString(),
    body: docBuffer,
  });

  const citationReport = await generateCitationReport(finalText, task.citation_style, displayTitle);
  const reportBuffer = await renderCitationReportPdf({
    citationStyle: task.citation_style,
    reportId: buildCitationReportId(new Date()),
    generatedAt: new Date().toISOString().slice(0, 10),
    essayTitle: displayTitle,
    ...citationReport,
  });
  const reportPath = `${taskId}/citation-report.pdf`;

  await storeGeneratedTaskFile({
    taskId,
    category: 'citation_report',
    originalName: 'citation-report.pdf',
    storagePath: reportPath,
    fileSize: reportBuffer.length,
    mimeType: 'application/pdf',
    expiresAtIso: expiresAt.toISOString(),
    body: reportBuffer,
  });
}

export async function regenerateDeliverableContent(input: WritingContextInput) {
  const versionBase = input.versionBase ?? await getDocumentVersionBase(input.taskId);
  const draft = await generateDraft({ ...input, versionBase });
  const calibrated = await calibrateWordCount(input.taskId, draft, input.targetWords, versionBase);
  return verifyCitations(input.taskId, calibrated, input.citationStyle, versionBase);
}

function buildCitationReportId(now: Date) {
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `Report ID: V532-${random}-${day}${month}`;
}

export async function generateCitationReport(text: string, citationStyle: string, essayTitle: string) {
  const prompt = buildCitationReportPrompt(text, citationStyle);

  // Keep report generation on the same tuning as citation verification until we
  // have a concrete need to split them into separate stages.
  const response = await openai.responses.create({
    ...buildMainOpenAIResponsesOptions('citation_verification'),
    input: [
      {
        role: 'system',
        content: prompt.systemPrompt,
      },
      {
        role: 'user',
        content: `${prompt.userPrompt}\n\nEssay title: ${essayTitle}`,
      },
    ],
  });

  return parseCitationReportData(typeof response.output_text === 'string' ? response.output_text : '', citationStyle);
}
