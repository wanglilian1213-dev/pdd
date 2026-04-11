import { streamResponseText } from '../lib/openai';
import { callWithUpstreamRetry, isTransientUpstreamError } from '../lib/upstreamRetry';
import { supabaseAdmin } from '../lib/supabase';
import { updateTaskStage, failTask, completeTask } from './taskService';
import { settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import { buildMainOpenAIResponsesOptions } from '../lib/openaiMainConfig';
import { buildFormattedPaperDocBuffer, buildFormattedPaperDocBufferWithMedia } from './documentFormattingService';
import { anthropic } from '../lib/anthropic';
import { renderCharts, type RenderedChart } from './chartRenderService';
import { parseRevisionOutput } from './revisionContentParser';
import { buildDocxFileName, normalizeDeliveryPaperTitle } from './paperTitleService';
import { getOrUploadMaterialContent, type StoredMaterialFile } from './materialInputService';
import {
  assessGeneratedPaper as assessGeneratedPaperInternal,
  summarizeReferenceCompliance,
} from './paperQualityService';
import {
  buildCitationReportPrompt,
  parseCitationReportData,
  renderCitationReportPdf,
  type CitationReportData,
} from './citationReportTemplateService';
import { deriveUnifiedTaskRequirements } from './taskRequirementService';

export const assessGeneratedPaper = assessGeneratedPaperInternal;
const DRAFT_GENERATION_TIMEOUT_MS = 1_800_000;
const WORD_CALIBRATION_TIMEOUT_MS = 900_000;
const CITATION_VERIFICATION_TIMEOUT_MS = 1_200_000;
const WORD_CALIBRATION_MAX_ATTEMPTS = 5;
const REFERENCE_REPAIR_MAX_ATTEMPTS = 2;
const CHART_ENHANCEMENT_TIMEOUT_MS = 300_000; // 5 minutes

const CRITICAL_PAPER_REASONS = new Set([
  'empty paper',
  'refusal content',
]);

function isCriticalPaperFailure(reasons: string[]) {
  return reasons.some((r) => CRITICAL_PAPER_REASONS.has(r));
}

interface WritingContextInput {
  taskId: string;
  materialFiles: StoredMaterialFile[];
  outline: string;
  paperTitle: string;
  researchQuestion: string;
  targetWords: number;
  citationStyle: string;
  requiredReferenceCount: number;
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

class WritingStageTimeoutError extends Error {
  constructor(stage: 'draft_generation' | 'word_calibration' | 'citation_verification', timeoutMs: number) {
    super(`${stage} timed out after ${timeoutMs}ms`);
    this.name = 'WritingStageTimeoutError';
  }
}

export function getStageTimeoutMs(stage: 'draft_generation' | 'word_calibration' | 'citation_verification') {
  switch (stage) {
    case 'draft_generation':
      return DRAFT_GENERATION_TIMEOUT_MS;
    case 'word_calibration':
      return WORD_CALIBRATION_TIMEOUT_MS;
    case 'citation_verification':
      return CITATION_VERIFICATION_TIMEOUT_MS;
  }
}

async function withRewriteStageTimeout<T>(
  stage: 'draft_generation' | 'word_calibration' | 'citation_verification',
  operation: Promise<T>,
  timeoutMs = getStageTimeoutMs(stage),
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new WritingStageTimeoutError(stage, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function isWritingStageTimeoutError(error: unknown) {
  return error instanceof WritingStageTimeoutError;
}

export function buildWritingFailureReason(stage: string, error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const errorName = error instanceof Error ? error.name : '';

  const timeoutStageMessages: Record<string, string> = {
    writing: '初稿生成超时，积分已自动退回。请稍后重试。',
    word_calibrating: '字数校准超时，积分已自动退回。请稍后重试。',
    citation_checking: '引用检查超时，积分已自动退回。请稍后重试。',
  };

  if (errorName === 'WritingStageTimeoutError' || isWritingStageTimeoutError(error)) {
    return timeoutStageMessages[stage] || '正文生成超时，积分已自动退回。请稍后重试。';
  }

  if (message.startsWith('draft_invalid:')) {
    if (message.includes('missing references') || message.includes('missing citation')) {
      return '初稿没有形成合格的引用内容，积分已自动退回。请稍后重试。';
    }

    if (message.includes('empty paper') || message.includes('refusal content')) {
      return '初稿内容不可用，积分已自动退回。请稍后重试。';
    }
  }

  const stageMessages: Record<string, string> = {
    writing: '初稿生成过程中出现问题',
    word_calibrating: '字数校准过程中出现问题',
    citation_checking: '引用检查过程中出现问题',
    delivering: '文件交付过程中出现问题',
  };

  const stageMsg = stageMessages[stage] || '正文生成过程中出现问题';
  return `${stageMsg}，积分已自动退回。请重新创建任务。`;
}

async function withDraftGenerationTimeout<T>(
  operation: Promise<T>,
  timeoutMs = getStageTimeoutMs('draft_generation'),
): Promise<T> {
  return withRewriteStageTimeout('draft_generation', operation, timeoutMs);
}

// ─── Transient upstream retry ─────────────────────────────────────────────
// Shared logic lives in lib/upstreamRetry.ts. This wrapper excludes
// WritingStageTimeoutError from being classified as transient.

const MAIN_RETRY_ATTEMPTS = {
  draft_generation: 3,
  word_calibration: 2,
  citation_verification: 2,
} as const;

function callMainOpenAIWithRetry<T>(
  stage: 'draft_generation' | 'word_calibration' | 'citation_verification',
  build: () => Promise<T>,
  maxAttempts: number = MAIN_RETRY_ATTEMPTS[stage],
): Promise<T> {
  return callWithUpstreamRetry(
    stage,
    build,
    maxAttempts,
    (err) => err instanceof WritingStageTimeoutError,
  );
}

function getWordCountRange(targetWords: number) {
  return {
    minWords: Math.floor(targetWords * 0.9),
    maxWords: Math.ceil(targetWords * 1.1),
  };
}

function stripLeadingTitleLine(text: string) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n');

  while (lines.length > 0 && !lines[0]!.trim()) {
    lines.shift();
  }

  const firstLine = lines[0]?.trim() || '';
  const nextNonEmptyLine = lines.slice(1).find((line) => line.trim())?.trim() || '';
  const looksLikeTitle = !!firstLine
    && firstLine.length <= 160
    && firstLine.split(/\s+/).length <= 25
    && !/[.?!]$/.test(firstLine)
    && !/\((19|20)\d{2}[a-z]?\)/.test(firstLine)
    && !!nextNonEmptyLine;

  if (looksLikeTitle) {
    lines.shift();
  }

  return lines.join('\n').trim();
}

function extractMainBodyText(text: string) {
  const withoutTitle = stripLeadingTitleLine(String(text || '').trim());
  const lines = withoutTitle.replace(/\r\n/g, '\n').split('\n');
  const referenceHeadingIndex = lines.findIndex((line) => /^(references|reference list|bibliography|works cited)\s*$/i.test(line.trim()));

  const bodyLines = referenceHeadingIndex >= 0 ? lines.slice(0, referenceHeadingIndex) : lines;
  return bodyLines.join('\n').trim();
}

function countMainBodyWords(text: string) {
  return extractMainBodyText(text)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .length;
}

function isMainBodyWordCountWithinRange(text: string, targetWords: number) {
  const { minWords, maxWords } = getWordCountRange(targetWords);
  const mainBodyWordCount = countMainBodyWords(text);

  return {
    mainBodyWordCount,
    minWords,
    maxWords,
    withinRange: mainBodyWordCount >= minWords && mainBodyWordCount <= maxWords,
  };
}

async function runWordCalibrationAttempts(options: {
  initialText: string;
  targetWords: number;
  maxAttempts?: number;
  rewrite: (text: string, attempt: number) => Promise<string>;
}) {
  let latestText = options.initialText;
  const maxAttempts = options.maxAttempts || WORD_CALIBRATION_MAX_ATTEMPTS;
  const initialRange = isMainBodyWordCountWithinRange(latestText, options.targetWords);

  if (initialRange.withinRange) {
    return {
      text: latestText,
      attemptsUsed: 0,
      ...initialRange,
    };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latestText = await options.rewrite(latestText, attempt);
    const range = isMainBodyWordCountWithinRange(latestText, options.targetWords);
    if (range.withinRange) {
      return {
        text: latestText,
        attemptsUsed: attempt,
        ...range,
      };
    }
  }

  const finalRange = isMainBodyWordCountWithinRange(latestText, options.targetWords);
  return {
    text: latestText,
    attemptsUsed: maxAttempts,
    ...finalRange,
  };
}

export const writingServiceTestUtils = {
  withRewriteStageTimeout,
  withDraftGenerationTimeout,
  isWritingStageTimeoutError,
  isTransientUpstreamError,
  callMainOpenAIWithRetry,
  MAIN_RETRY_ATTEMPTS,
  getStageTimeoutMs,
  getWordCountRange,
  countMainBodyWords,
  isMainBodyWordCountWithinRange,
  runWordCalibrationAttempts,
};

function deriveWritingTaskRequirements(task: {
  target_words?: number | null;
  citation_style?: string | null;
  required_reference_count?: number | null;
}) {
  const derived = deriveUnifiedTaskRequirements({
    targetWords: typeof task.target_words === 'number' ? task.target_words : undefined,
    citationStyle: typeof task.citation_style === 'string' ? task.citation_style : undefined,
  });

  return {
    targetWords: derived.targetWords,
    citationStyle: derived.citationStyle,
    requiredReferenceCount: Number(task.required_reference_count || derived.requiredReferenceCount),
  };
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

export function buildFinalDocDescriptor(taskId: string, rawTitle: string | null | undefined, fallback = 'Academic Essay') {
  return {
    originalName: buildDocxFileName(rawTitle, fallback),
    storagePath: `${taskId}/final-paper.docx`,
  };
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
    const unifiedRequirements = deriveWritingTaskRequirements(task);

    // Step 1: Draft
    await updateTaskStage(taskId, 'writing');
    const draft = await generateDraft({
      taskId,
      materialFiles: materialFiles as StoredMaterialFile[],
      outline: latestOutline.content,
      paperTitle,
      researchQuestion,
      targetWords: unifiedRequirements.targetWords,
      citationStyle: unifiedRequirements.citationStyle,
      requiredReferenceCount: unifiedRequirements.requiredReferenceCount,
      requirements: task.special_requirements,
      versionBase,
    });

    // Step 2: Calibrate
    await updateTaskStage(taskId, 'word_calibrating');
    const calibrated = await calibrateWordCount(
      taskId,
      draft,
      unifiedRequirements.targetWords,
      unifiedRequirements.citationStyle,
      unifiedRequirements.requiredReferenceCount,
      versionBase,
    );

    // Step 3: Citation check
    await updateTaskStage(taskId, 'citation_checking');
    const verified = await verifyCitations(
      taskId,
      calibrated,
      unifiedRequirements.citationStyle,
      unifiedRequirements.requiredReferenceCount,
      versionBase,
    );

    // Step 3.5: Chart enhancement (best-effort, never fails the task)
    await updateTaskStage(taskId, 'delivering');
    const chartResult = await enhanceWithCharts(verified, paperTitle, researchQuestion);

    // Step 4: Deliver
    await deliverResults(taskId, userId, verified, {
      ...task,
      target_words: unifiedRequirements.targetWords,
      citation_style: unifiedRequirements.citationStyle,
      required_reference_count: unifiedRequirements.requiredReferenceCount,
    }, versionBase, chartResult);

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
    const techDetail = err instanceof Error ? `${err.name}: ${err.message}` : String(err || '');

    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('user_id, frozen_credits, stage')
      .eq('id', taskId)
      .single();

    if (task && task.frozen_credits > 0) {
      try {
        await refundCredits(task.user_id, task.frozen_credits, 'task', taskId, `正文生成失败退款：${task.frozen_credits} 积分`);
        await failTask(taskId, task.stage, buildWritingFailureReason(task.stage, err), true, techDetail);
      } catch (refundErr) {
        console.error(`Refund failed for task ${taskId}:`, refundErr);
        await failTask(taskId, task.stage, '正文生成失败，退款异常，请联系客服处理。', false, techDetail);
      }
    } else {
      await failTask(taskId, 'writing', '正文生成失败。', false, techDetail);
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

export function buildDraftGenerationSystemPrompt(
  targetWords: number,
  citationStyle: string,
  requiredReferenceCount: number,
) {
  return `You are an academic writing expert.

Write the entire article at once.
Write all chapters from the provided outline in order.
Each chapter must start with its section title as a plain-text heading on its own line, exactly as named in the outline.
The target word count is approximately ${targetWords} words.
Use ${citationStyle} citation style.
Write only the paper content, with no meta-commentary.
Include proper in-text citations and a references section.
Use at least ${requiredReferenceCount} references.
Every reference must be from 2020 onwards.
Every reference must be an academic scholar paper.
Do not use book sources. References must be academic scholar papers, not books.

You have access to the web_search tool. Before writing any in-text citation or any entry in the references section, you MUST use web_search to verify that the cited work actually exists. Search for the exact title, the author name combined with the year, and the DOI when possible. Only cite a work after web_search returns a credible match (a publisher page, a Crossref entry, a journal landing page, or an indexed scholarly database). If web_search cannot find a real source for a claim, weaken or remove the claim instead of inventing a citation. Never fabricate authors, titles, journals, years, DOIs, or URLs. Every reference in the final references section must correspond to a real paper that you confirmed via web_search during this turn.

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
Do not use Markdown syntax, Markdown emphasis markers, backticks, or Markdown list markers.
Section headings must be written as plain text on their own line (e.g. "Introduction", "2. Literature Review"), not as Markdown headings with # symbols.
Return clean academic prose only.

each references should come with proper link.`;
}

export function buildWordCalibrationSystemPrompt(
  currentWords: number,
  targetWords: number,
  citationStyle: string,
  requiredReferenceCount: number,
) {
  const { minWords, maxWords } = getWordCountRange(targetWords);

  return `You are an academic writing editor. The current main body word count is ${currentWords} words. The target main body word count is ${targetWords} words, and the allowed range is ${minWords} to ${maxWords} words. ${currentWords < minWords ? 'Expand' : 'Condense'} the paper so the main body falls inside that exact range while maintaining quality and coherence.
This calibration is for the main body word count only.
The title and references do not count toward the target word count.
The main body must land within ${minWords}-${maxWords} words.
This is a very strict rule, must follow.
Keep ${citationStyle} citation style.
Keep at least ${requiredReferenceCount} references.
All references must be from 2020 onwards.
All references must remain academic scholar paper sources, not book sources.
Output only the revised paper.
Do not use Markdown syntax, Markdown emphasis markers, Markdown headings, backticks, or Markdown list markers.
Return clean academic prose only.`;
}

export function buildCitationVerificationSystemPrompt(citationStyle: string, requiredReferenceCount: number) {
  return `You are a citation verification expert. Review the paper and ensure all citations follow ${citationStyle} format.
Keep at least ${requiredReferenceCount} references.
All references must be from 2020 onwards.
All references must remain academic scholar paper sources, not book sources.

You have access to the web_search tool. For every reference in the references section, you MUST use web_search to verify that the work actually exists (search for title, author+year, or DOI). If web_search confirms the work, keep it and ensure the formatting matches ${citationStyle}. If web_search cannot find the work, replace it with a real paper that supports the same in-text claim, found via web_search. Never leave a fabricated reference in the paper. Never invent DOIs, URLs, journals, or author names.

Fix any formatting issues. Output the corrected paper text only.
Do not use Markdown syntax, Markdown emphasis markers, Markdown headings, backticks, or Markdown list markers.
Return clean academic prose only.`;
}

function buildReferenceRepairSystemPrompt(
  citationStyle: string,
  requiredReferenceCount: number,
  issues: string[],
) {
  return `You are an academic reference repair specialist.
The following issues were found with the paper's references:
${issues.map((issue) => `- ${issue}`).join('\n')}

Fix ALL identified issues in the paper below:
- If reference count is below ${requiredReferenceCount}, add more real academic journal paper references with proper in-text citations in the body.
- If any references are from before 2020, replace them with references from 2020 onwards.
- If any references look like books or non-academic sources, replace them with academic journal paper references.
- Every reference must be an academic scholar paper. Do not use book sources.
- ALL references must include real, accurate, and verifiable links (DOI or journal URL). Do NOT fabricate any reference or use any fake or broken link. Every reference must be a real published work that actually exists.
- Each reference should include a proper DOI link or journal URL.

Keep the main body text and arguments unchanged. Only fix the references and their corresponding in-text citations.
Output the complete paper with all fixes applied.
Do not use Markdown syntax, Markdown emphasis markers, Markdown headings, backticks, or Markdown list markers.
Section headings must be written as plain text on their own line.
Return clean academic prose only.`;
}

async function repairReferenceIssues(
  text: string,
  options: {
    citationStyle: string;
    requiredReferenceCount: number;
    issues: string[];
    maxAttempts?: number;
  },
): Promise<string> {
  let current = text;
  const maxAttempts = options.maxAttempts || REFERENCE_REPAIR_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentAssessment = assessGeneratedPaper(current, {
      requiredReferenceCount: options.requiredReferenceCount,
      citationStyle: options.citationStyle,
    });

    const referenceIssues = currentAssessment.reasons.filter((r) => !CRITICAL_PAPER_REASONS.has(r));
    if (referenceIssues.length === 0) break;

    try {
      const previousText = current;

      const { text: repairedText } = await withRewriteStageTimeout(
        'citation_verification',
        callMainOpenAIWithRetry('citation_verification', () =>
          streamResponseText({
            ...buildMainOpenAIResponsesOptions('citation_verification'),
            instructions: buildReferenceRepairSystemPrompt(
              options.citationStyle,
              options.requiredReferenceCount,
              referenceIssues,
            ),
            input: [
              {
                role: 'user' as const,
                content: current,
              },
            ],
          }),
        ),
      );

      const repaired = repairedText || current;

      // Only use repaired version if it doesn't introduce critical issues
      const repairedAssessment = assessGeneratedPaper(repaired, {
        requiredReferenceCount: options.requiredReferenceCount,
        citationStyle: options.citationStyle,
      });

      if (!isCriticalPaperFailure(repairedAssessment.reasons)) {
        current = repaired;
      }

      // No progress — further attempts will not help
      if (current === previousText) break;

      if (repairedAssessment.valid) break;
    } catch (error) {
      if (!isWritingStageTimeoutError(error)) throw error;
      break;
    }
  }

  return current;
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
  const materialContent = await getOrUploadMaterialContent(input.taskId);

  const { text: draftText } = await withDraftGenerationTimeout(
      callMainOpenAIWithRetry('draft_generation', () =>
        streamResponseText({
          ...buildMainOpenAIResponsesOptions('draft_generation'),
          instructions: buildDraftGenerationSystemPrompt(
            input.targetWords,
            input.citationStyle,
            input.requiredReferenceCount,
          ),
          input: [
            {
              role: 'user' as const,
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
        }),
      ),
    );

    let content = draftText;
    let assessment = assessGeneratedPaper(content, {
      requiredReferenceCount: input.requiredReferenceCount,
      citationStyle: input.citationStyle,
    });

    if (!assessment.valid) {
      const { text: repairedDraftText } = await withDraftGenerationTimeout(
        callMainOpenAIWithRetry('draft_generation', () =>
          streamResponseText({
            ...buildMainOpenAIResponsesOptions('draft_generation'),
            instructions: buildDraftGenerationSystemPrompt(
              input.targetWords,
              input.citationStyle,
              input.requiredReferenceCount,
            ),
            input: [
              {
                role: 'user' as const,
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
          }),
        ),
      );

      content = repairedDraftText || content;
      assessment = assessGeneratedPaper(content, {
        requiredReferenceCount: input.requiredReferenceCount,
        citationStyle: input.citationStyle,
      });
      if (!assessment.valid) {
        // Critical failures cannot be repaired further
        if (isCriticalPaperFailure(assessment.reasons)) {
          const critical = assessment.reasons.filter((r) => CRITICAL_PAPER_REASONS.has(r));
          throw new Error(`draft_invalid:${critical.join(',')}`);
        }

        // Reference quality issues — attempt targeted repair
        content = await repairReferenceIssues(content, {
          citationStyle: input.citationStyle,
          requiredReferenceCount: input.requiredReferenceCount,
          issues: assessment.reasons,
        });

        const finalAssessment = assessGeneratedPaper(content, {
          requiredReferenceCount: input.requiredReferenceCount,
          citationStyle: input.citationStyle,
        });
        if (!finalAssessment.valid) {
          console.warn(`Draft reference issues persist after repair for task ${input.taskId}: ${finalAssessment.reasons.join(', ')}`);
        }
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
}

async function calibrateWordCount(
  taskId: string,
  draft: string,
  targetWords: number,
  citationStyle: string,
  requiredReferenceCount: number,
  versionBase = 0,
): Promise<string> {
  const initialRange = isMainBodyWordCountWithinRange(draft, targetWords);

  if (initialRange.withinRange) {
    await supabaseAdmin.from('document_versions').insert({
      task_id: taskId,
      version: versionBase + 2,
      stage: 'calibrated',
      word_count: initialRange.mainBodyWordCount,
      content: draft,
    });
    return draft;
  }

  const calibrationResult = await runWordCalibrationAttempts({
    initialText: draft,
    targetWords,
    maxAttempts: WORD_CALIBRATION_MAX_ATTEMPTS,
    rewrite: async (currentText) => {
      const currentWords = countMainBodyWords(currentText);
      let calibrated = currentText;

      try {
        const { text: calibratedText } = await withRewriteStageTimeout(
          'word_calibration',
          callMainOpenAIWithRetry('word_calibration', () =>
            streamResponseText({
              ...buildMainOpenAIResponsesOptions('word_calibration'),
              instructions: buildWordCalibrationSystemPrompt(currentWords, targetWords, citationStyle, requiredReferenceCount),
              input: [
                {
                  role: 'user' as const,
                  content: currentText,
                },
              ],
            }),
          ),
        );

        calibrated = calibratedText || currentText;
      } catch (error) {
        if (!isWritingStageTimeoutError(error)) {
          throw error;
        }
      }

      let assessment = assessGeneratedPaper(calibrated, {
        requiredReferenceCount,
        citationStyle,
      });

      if (!assessment.valid) {
        try {
          const { text: repairedCalText } = await withRewriteStageTimeout(
            'word_calibration',
            callMainOpenAIWithRetry('word_calibration', () =>
              streamResponseText({
                ...buildMainOpenAIResponsesOptions('word_calibration'),
                instructions: buildWordCalibrationSystemPrompt(currentWords, targetWords, citationStyle, requiredReferenceCount),
                input: [
                  {
                    role: 'user' as const,
                    content: buildStageRepairUserPrompt({
                      lastGoodText: currentText,
                      brokenText: calibrated,
                      reasons: assessment.reasons,
                      stage: 'word_calibration',
                    }),
                  },
                ],
              }),
            ),
          );

          const repaired = repairedCalText || currentText;
          assessment = assessGeneratedPaper(repaired, {
            requiredReferenceCount,
            citationStyle,
          });
          calibrated = assessment.valid ? repaired : currentText;
        } catch (error) {
          if (!isWritingStageTimeoutError(error)) {
            throw error;
          }
          calibrated = currentText;
        }
      }

      return calibrated;
    },
  });

  const calibrated = calibrationResult.text;
  const newWordCount = calibrationResult.mainBodyWordCount;

  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: versionBase + 2,
    stage: 'calibrated',
    word_count: newWordCount,
    content: calibrated,
  });

  return calibrated;
}

async function verifyCitations(
  taskId: string,
  text: string,
  citationStyle: string,
  requiredReferenceCount: number,
  versionBase = 0,
): Promise<string> {
  let verified = text;

  try {
    const { text: verifiedText } = await withRewriteStageTimeout(
      'citation_verification',
      callMainOpenAIWithRetry('citation_verification', () =>
        streamResponseText({
          ...buildMainOpenAIResponsesOptions('citation_verification'),
          instructions: buildCitationVerificationSystemPrompt(citationStyle, requiredReferenceCount),
          input: [
            {
              role: 'user' as const,
              content: text,
            },
          ],
        }),
      ),
    );

    verified = verifiedText || text;
  } catch (error) {
    if (!isWritingStageTimeoutError(error)) {
      throw error;
    }
  }
  let assessment = assessGeneratedPaper(verified, {
    requiredReferenceCount,
    citationStyle,
  });

  if (!assessment.valid) {
    try {
      const { text: repairedCiteText } = await withRewriteStageTimeout(
        'citation_verification',
        callMainOpenAIWithRetry('citation_verification', () =>
          streamResponseText({
            ...buildMainOpenAIResponsesOptions('citation_verification'),
            instructions: buildCitationVerificationSystemPrompt(citationStyle, requiredReferenceCount),
            input: [
              {
                role: 'user' as const,
                content: buildStageRepairUserPrompt({
                  lastGoodText: text,
                  brokenText: verified,
                  reasons: assessment.reasons,
                  stage: 'citation_verification',
                }),
              },
            ],
          }),
        ),
      );

      const repaired = repairedCiteText || text;
      assessment = assessGeneratedPaper(repaired, {
        requiredReferenceCount,
        citationStyle,
      });
      verified = assessment.valid ? repaired : text;
    } catch (error) {
      if (!isWritingStageTimeoutError(error)) {
        throw error;
      }
      verified = text;
    }
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

// ─── Chart Enhancement (Claude + Chart DSL + QuickChart rendering) ──────────

function buildChartEnhancementSystemPrompt(): string {
  return `You are an academic paper visualization specialist. Your task is to analyze a completed English academic paper and enhance it with 1-2 visual charts and optionally tables.

MANDATORY CHART REQUIREMENT:
You MUST include at least 1 chart (and up to 2). Almost every academic paper can benefit from at least one figure that summarizes, compares, or visualizes key data, concepts, frameworks, or relationships discussed in the paper. Even if the paper does not contain raw numbers, you can create:
- A conceptual comparison chart (e.g., bar chart comparing factors, dimensions, or categories discussed)
- A framework visualization (e.g., radar chart showing multiple dimensions of analysis)
- A trend or relationship chart based on data mentioned in references
- A proportional chart (e.g., pie/doughnut showing distribution of themes, factors, or components)

The ONLY exception where you may skip charts is if the paper is a purely abstract philosophical reflection with zero comparisons, categories, or frameworks of any kind. This is extremely rare.

CHART RULES:
- Add 1-2 charts. Chart data must be derived from information ALREADY discussed in the paper — statistics, comparisons, frameworks, categories, or referenced data. You may synthesize reasonable representative values to illustrate concepts discussed in the text, but do not invent unrelated data.
- Use the following DSL to define charts. The system will automatically render them into real images embedded in the Word document. Do NOT output Python, matplotlib, R, SVG, or any code. Do NOT output markdown image links like ![...](url). Only use this exact DSL format:

[CHART_BEGIN]
{
  "title": "Figure 1: Example Title",
  "width": 720,
  "height": 440,
  "chartjs": {
    "type": "bar",
    "data": {
      "labels": ["Category A", "Category B", "Category C"],
      "datasets": [{ "label": "Metric", "data": [10, 20, 30] }]
    },
    "options": {
      "plugins": { "title": { "display": true, "text": "Example Title" } },
      "scales": { "y": { "beginAtZero": true } }
    }
  }
}
[CHART_END]

- Insert the chart block at the appropriate position WITHIN the paper body sections. NEVER place charts after the References section.
- The [CHART_BEGIN]...[CHART_END] block must be on its own lines with a blank line before and after.
- Near each chart, add a brief reference sentence in the text (e.g., "As illustrated in Figure 1, ..." or "Figure 2 demonstrates that ...").

DSL HARD RULES (violating any of these will cause rendering failure):
- chartjs must be a valid Chart.js v3 JSON config (type / data / options). No callbacks, function strings, or unlisted fields.
- chartjs.type must be one of: line / bar / pie / doughnut / radar / scatter / bubble / polarArea. No other types.
- chartjs.data.labels must be a string array, length <= 50, each string <= 80 characters.
- chartjs.data.datasets must be an array, length <= 5.
- Each dataset.data must be a pure number array (for line/bar/pie/doughnut/radar/polarArea), length <= 100. Exception: scatter/bubble types may use {x: number, y: number} or {x, y, r} objects. No string numbers ("12.5"), no null values.
- Each dataset.label <= 80 characters.
- title <= 80 characters. Use "Figure N: xxx" format, numbered in order of appearance.
- options: only plugins.title / plugins.legend / scales.{x,y}.beginAtZero are allowed. Do not write other options fields.
- The entire [CHART_BEGIN]...[CHART_END] block (including JSON) must be <= 30KB.
- One chart per [CHART_BEGIN]...[CHART_END] block.
- If data exceeds limits (e.g., 200 time points), aggregate or truncate to <= 50 representative points.

TABLE RULES:
- If some data in the paper is better presented as a table, use standard Markdown table syntax:

| Column 1 | Column 2 | Column 3 |
| --- | --- | --- |
| Data | Data | Data |

- Tables must have a blank line before and after.
- Add a caption line above the table: "Table N: Description"
- Tables must NOT contain in-text citations or references (e.g., no "(Author, 2023)" inside table cells).
- Tables should only present data summaries, comparisons, or frameworks.
- Tables must be placed WITHIN the paper body sections, NEVER after the References section.

ABSOLUTE CONSTRAINTS:
- ALL charts and tables must be placed WITHIN the paper body sections, NEVER after the References section.
- Do NOT modify any existing text in the paper except to add figure/table reference sentences.
- Do NOT rephrase, reorder, or rewrite any existing sentences or paragraphs.
- Do NOT add new arguments, evidence, or references that were not in the original paper.
- Do NOT use Markdown heading syntax (#), bold (**), or any other Markdown formatting in the paper body text.
- The paper's section headings, references section, and citation style must remain exactly as they were.
- Output the COMPLETE paper text — do not truncate or summarize.`;
}

interface ChartEnhancementResult {
  text: string;
  mediaMap: Map<string, RenderedChart>;
}

async function enhanceWithCharts(
  verifiedText: string,
  paperTitle: string,
  researchQuestion: string,
): Promise<ChartEnhancementResult> {
  const empty: ChartEnhancementResult = {
    text: verifiedText,
    mediaMap: new Map<string, RenderedChart>(),
  };

  try {
    // Use streaming to avoid Anthropic SDK timeout on long-running requests.
    // Non-streaming calls with large max_tokens error out with
    // "Streaming is required for operations that may take longer than 10 minutes".
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 64000,
      system: buildChartEnhancementSystemPrompt(),
      thinking: {
        type: 'adaptive',
      } as any,
      ...({ output_config: { effort: 'max' } } as any),
      messages: [
        {
          role: 'user',
          content: `Below is a completed academic paper titled "${paperTitle}" (research question: "${researchQuestion}"). Analyze it and enhance with charts and/or tables if appropriate.\n\n${verifiedText}`,
        },
      ],
    } as any);

    const response = await Promise.race([
      stream.finalMessage(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('chart enhancement timeout')), CHART_ENHANCEMENT_TIMEOUT_MS),
      ),
    ]);

    // Extract text from Claude response (skip thinking blocks)
    const resp = response as any;
    const rawText = resp.content
      ?.filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n\n') || '';

    console.log(
      `[chart-enhance] stop=${resp.stop_reason}, ` +
      `blocks=${resp.content?.length ?? 0}, ` +
      `text_len=${rawText.length}, ` +
      `has_chart_dsl=${rawText.includes('[CHART_BEGIN')}, ` +
      `usage=${JSON.stringify(resp.usage ?? {})}`,
    );

    if (!rawText) {
      console.warn('[chart-enhance] Claude returned empty text, using original');
      return empty;
    }

    // Safety check: Claude must not significantly alter the paper text.
    // Strip chart DSL blocks + table rows before comparing word counts.
    const cleanForCheck = rawText
      .replace(/\[CHART_BEGIN\][\s\S]*?\[CHART_END\]/g, '')
      .replace(/^\|[^\n]*\|$/gm, '')
      .trim();
    const originalWords = countMainBodyWords(verifiedText);
    const enhancedWords = countMainBodyWords(cleanForCheck);

    if (originalWords > 0 && Math.abs(enhancedWords - originalWords) > originalWords * 0.08) {
      console.warn(
        `[chart-enhance] AI mutated text (original=${originalWords}, enhanced=${enhancedWords}), discarding`,
      );
      return empty;
    }

    // Parse chart DSL → placeholders + chart specs (reuse revision parser)
    const { text: textWithPlaceholders, charts } = parseRevisionOutput(rawText);

    if (charts.length === 0) {
      // No charts — Claude decided none needed (may still have tables)
      console.log('[chart-enhance] no charts generated (may have tables)');
      return { text: textWithPlaceholders, mediaMap: new Map() };
    }

    // Render charts via QuickChart.io (reuse revision renderer)
    const rendered = await renderCharts(charts.map((c) => c.spec));
    const mediaMap = new Map<string, RenderedChart>();
    charts.forEach((c, idx) => {
      mediaMap.set(c.token, rendered[idx]!);
    });

    const ok = rendered.filter((r) => r.png).length;
    console.log(`[chart-enhance] charts=${charts.length}, rendered_ok=${ok}, failed=${charts.length - ok}`);

    return { text: textWithPlaceholders, mediaMap };
  } catch (err: any) {
    console.warn('[chart-enhance] failed, delivering without charts:', err?.message || err);
    return empty;
  }
}

async function deliverResults(taskId: string, userId: string, finalText: string, task: any, versionBase = 0, chartData?: ChartEnhancementResult) {
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

  // Use media-aware docx builder when chart data is available
  const textForDoc = chartData?.text ?? finalText;
  const mediaMap = chartData?.mediaMap ?? new Map<string, RenderedChart>();
  const hasMedia = mediaMap.size > 0 || /^\|[^\n]*\|$/m.test(textForDoc);
  const docBuffer = hasMedia
    ? await buildFormattedPaperDocBufferWithMedia(textForDoc, mediaMap, {
        paperTitle: displayTitle,
        courseCode: task.course_code,
      })
    : await buildFormattedPaperDocBuffer(finalText, {
        paperTitle: displayTitle,
        courseCode: task.course_code,
      });
  const finalDoc = buildFinalDocDescriptor(taskId, task.paper_title || task.title, 'Academic Essay');

  await storeGeneratedTaskFile({
    taskId,
    category: 'final_doc',
    originalName: finalDoc.originalName,
    storagePath: finalDoc.storagePath,
    fileSize: docBuffer.length,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    expiresAtIso: expiresAt.toISOString(),
    body: docBuffer,
  });

  try {
    const citationReport = await generateCitationReport(
      finalText,
      task.citation_style,
      displayTitle,
      Number(task.required_reference_count || deriveWritingTaskRequirements(task).requiredReferenceCount),
    );
    const reportBuffer = await renderCitationReportPdf(citationReport);
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
  } catch (reportErr) {
    const isTimeout = reportErr instanceof Error && reportErr.name === 'WritingStageTimeoutError';
    const reason = isTimeout ? 'timeout' : (reportErr instanceof Error ? reportErr.message : String(reportErr));
    console.error(`[citation-report] task=${taskId} failed reason=${reason}`, reportErr);
  }
}

export async function regenerateDeliverableContent(input: WritingContextInput) {
  const versionBase = input.versionBase ?? await getDocumentVersionBase(input.taskId);
  const draft = await generateDraft({ ...input, versionBase });
  const calibrated = await calibrateWordCount(
    input.taskId,
    draft,
    input.targetWords,
    input.citationStyle,
    input.requiredReferenceCount,
    versionBase,
  );
  return verifyCitations(
    input.taskId,
    calibrated,
    input.citationStyle,
    input.requiredReferenceCount,
    versionBase,
  );
}

function buildCitationReportId(now: Date) {
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `Report ID: V532-${random}-${day}${month}`;
}

export async function generateCitationReport(
  text: string,
  citationStyle: string,
  essayTitle: string,
  requiredReferenceCount: number,
): Promise<CitationReportData> {
  const compliance = summarizeReferenceCompliance(text);
  const prompt = buildCitationReportPrompt(text, citationStyle, {
    requiredReferenceCount,
    actualReferenceCount: compliance.totalReferences,
    compliant2020Count: compliance.referencesFrom2020Onward,
    suspectedBookCount: compliance.suspectedBookCount,
    suspectedNonAcademicCount: compliance.suspectedNonAcademicCount,
  });

  // Keep report generation on the same tuning as citation verification until we
  // have a concrete need to split them into separate stages.
  // Timeout here is an explicit failure — do not silently deliver a fake report.
  const { text: rawReportText } = await withRewriteStageTimeout(
    'citation_verification',
    callMainOpenAIWithRetry('citation_verification', () =>
      streamResponseText({
        ...buildMainOpenAIResponsesOptions('citation_verification'),
        instructions: prompt.systemPrompt,
        input: [
          {
            role: 'user' as const,
            content: `${prompt.userPrompt}\n\nEssay title: ${essayTitle}`,
          },
        ],
      }),
    ),
  );

  const parsed = parseCitationReportData(rawReportText, citationStyle);
  const now = new Date();

  return {
    reportId: buildCitationReportId(now),
    generatedAt: now.toISOString().slice(0, 10),
    essayTitle,
    citationStyle,
    ...parsed,
    keyFindings: [
      `This task requires at least ${requiredReferenceCount} references. The essay currently contains ${compliance.totalReferences}.`,
      `${compliance.referencesFrom2020Onward} references appear to be from 2020 onwards.`,
      `${compliance.suspectedBookCount} references look like books and ${compliance.suspectedNonAcademicCount} look non-compliant with the academic paper rule.`,
      ...parsed.keyFindings,
    ],
  };
}
