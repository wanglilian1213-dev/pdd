import { streamResponseText } from '../lib/openai';
import { env } from '../lib/runtimeEnv';
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
  extractReferenceEntries,
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
const POLISHING_TIMEOUT_MS = 600_000; // 10 minutes

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
    polishing: '润色处理超时，积分已自动退回。请稍后重试。',
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
    polishing: '润色过程中出现问题',
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

export { countMainBodyWords, getWordCountRange };

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

    // Step 3.5: Polish (best-effort, never fails the task)
    await updateTaskStage(taskId, 'polishing');
    const polished = await polishText(taskId, verified, versionBase, unifiedRequirements.targetWords);

    // Step 3.6: Chart enhancement (best-effort, never fails the task)
    await updateTaskStage(taskId, 'delivering');
    const chartResult = await enhanceWithCharts(
      polished, paperTitle, researchQuestion,
      unifiedRequirements.targetWords,
      task.special_requirements,
      latestOutline.content,
    );

    // Step 4: Deliver (store final version + Word file + citation report)
    const taskMeta = {
      ...task,
      target_words: unifiedRequirements.targetWords,
      citation_style: unifiedRequirements.citationStyle,
      required_reference_count: unifiedRequirements.requiredReferenceCount,
    };
    await deliverResults(taskId, userId, polished, taskMeta, versionBase, chartResult);

    // Step 4.5: Citation report (best-effort, with process-level crash guard)
    // The OpenAI stream call through sub2api/Cloudflare can throw uncaught
    // exceptions that crash the Node process. The temporary handler prevents this.
    const retentionDays = (await getConfig('result_file_retention_days')) || 3;
    const reportExpiry = new Date();
    reportExpiry.setDate(reportExpiry.getDate() + retentionDays);
    const displayTitle = normalizeDeliveryPaperTitle(
      taskMeta.paper_title || taskMeta.title, 'Academic Essay',
    );
    const uncaughtGuard = (err: Error) => {
      console.error(`[citation-report] uncaught exception caught for task ${taskId}:`, err?.message || err);
    };
    process.on('uncaughtException', uncaughtGuard);
    try {
      await generateAndStoreCitationReport(
        taskId, polished, taskMeta, displayTitle, reportExpiry,
      );
    } finally {
      process.removeListener('uncaughtException', uncaughtGuard);
    }

    // Success: settle + complete
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

// ─── Polishing (Claude – reduce AI-generated feel) ─────────────────────────

function buildPolishingSystemPrompt(targetWords: number, currentWords: number): string {
  const { minWords, maxWords } = getWordCountRange(targetWords);
  const needsCondense = currentWords > maxWords;
  const needsExpand = currentWords < minWords;

  const wordCountRule = needsCondense
    ? `\nWORD COUNT CORRECTION (CRITICAL):
The current main body is ${currentWords} words but the target is ${targetWords} words (allowed range: ${minWords}–${maxWords}). You MUST condense the main body to fall within that range while polishing. Cut redundant elaboration, merge repetitive sentences, tighten verbose phrasing — but keep all citations and references intact.`
    : needsExpand
      ? `\nWORD COUNT CORRECTION (CRITICAL):
The current main body is ${currentWords} words but the target is ${targetWords} words (allowed range: ${minWords}–${maxWords}). You MUST expand the main body to fall within that range while polishing. Add supporting analysis, elaborate on key arguments — but do not invent new citations.`
      : `\n- Keep word count within ±5% of current count`;

  return `You are an academic writing style editor. Your task is to reduce the "AI-generated" feel of the following academic paper while preserving its full content, structure, argument, and all citations.

WHAT TO FIX:
1. Replace overused AI transition words with simpler alternatives:
   - "Furthermore" / "Moreover" / "Additionally" → "Also", "Besides", "And", or restructure
   - "Consequently" / "Subsequently" → "So", "Then", "As a result"
   - "Indeed" / "Notably" / "Importantly" → remove or replace with context-specific phrasing
   - "delve" / "delve into" → "examine", "explore", "look at"
   - "leverage" / "utilize" / "harness" → "use", "apply", "draw on"
   - "landscape" (metaphorical) → "field", "area", "situation"
   - "multifaceted" / "nuanced" → be specific about the actual facets/nuances
   - "It is important to note that" / "It is worth mentioning that" → cut the hedge, state it directly

2. Vary sentence structure:
   - Break consecutive same-pattern sentences (e.g. "This study...", "This approach...")
   - Mix short (8-12 words) with long (25-35 words) sentences
   - Not every sentence needs a subordinate clause

3. Vary paragraph lengths:
   - Some paragraphs 2-3 sentences, others 5-7
   - Section opening/closing paragraphs can be shorter

4. Make vague descriptions more specific:
   - "plays a significant role" → state what role
   - "has been widely discussed" → by whom, in what context
   - "various factors" → name them or say "several factors including X and Y"

5. Sound like a competent student, not a language model:
   - Occasional first-person if appropriate
   - Allow minor stylistic imperfections
   - Natural rhythm over mechanical precision

ABSOLUTE CONSTRAINTS:
- Do NOT alter ANY in-text citations "(Author, Year)" or "[N]" — keep them character-for-character
- Do NOT alter ANY reference entries in the References section — reproduce character-for-character
- Do NOT change section headings
- Do NOT add or remove arguments, evidence, or claims
- Do NOT change the structure or order of paragraphs/sections${wordCountRule}
- Do NOT use Markdown syntax (no #, **, __, \`, -, *)
- Output the COMPLETE paper — no truncation, no preamble, no commentary`;
}

async function polishText(
  taskId: string,
  inputText: string,
  versionBase: number,
  targetWords: number,
): Promise<string> {
  try {
    const currentWords = countMainBodyWords(inputText);

    const { text: polishedText } = await Promise.race([
      streamResponseText({
        model: env.openaiModel,
        instructions: buildPolishingSystemPrompt(targetWords, currentWords),
        reasoning: { effort: 'high' as any },
        input: inputText,
      } as any),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('polishing timeout')), POLISHING_TIMEOUT_MS),
      ),
    ]);

    console.log(`[polish] done, text_len=${polishedText.length}`);

    if (!polishedText) {
      console.warn(`[polish] GPT returned empty text for task ${taskId}, using original`);
      return inputText;
    }

    // Safety check 1: reference count must be preserved
    const origRefs = extractReferenceEntries(inputText);
    const polishedRefs = extractReferenceEntries(polishedText);
    if (polishedRefs.length < origRefs.length) {
      console.warn(
        `[polish] references dropped from ${origRefs.length} to ${polishedRefs.length} for task ${taskId}, using original`,
      );
      return inputText;
    }

    // Safety check 2: in-text citations must still be present
    const citationPattern = /\([^)]+,\s*(19|20)\d{2}[a-z]?\)|\b[A-Z][A-Za-z-]+(?:\s+et al\.)?\s*\((19|20)\d{2}[a-z]?\)|\[\d+(?:\s*[,\u2013-]\s*\d+)*\]/g;
    const origCitations = (inputText.match(citationPattern) || []).length;
    const polishedCitations = (polishedText.match(citationPattern) || []).length;
    if (origCitations > 0 && polishedCitations < origCitations * 0.9) {
      console.warn(
        `[polish] in-text citations dropped from ${origCitations} to ${polishedCitations} for task ${taskId}, using original`,
      );
      return inputText;
    }

    // Safety check 3: word count must be within target ±10% (or at least not worse than before)
    const polishedWords = countMainBodyWords(polishedText);
    const { minWords: targetMin, maxWords: targetMax } = getWordCountRange(targetWords);
    const polishedInRange = polishedWords >= targetMin && polishedWords <= targetMax;
    const origInRange = currentWords >= targetMin && currentWords <= targetMax;
    // Reject only if: (a) original was in range but polished went out, or
    // (b) original was out of range and polished made it worse (further from target)
    if (origInRange && !polishedInRange) {
      console.warn(
        `[polish] word count left target range: ${currentWords} → ${polishedWords} (target ${targetMin}-${targetMax}) for task ${taskId}, using original`,
      );
      return inputText;
    }
    if (!origInRange && !polishedInRange) {
      const origDist = Math.abs(currentWords - targetWords);
      const polishDist = Math.abs(polishedWords - targetWords);
      if (polishDist > origDist) {
        console.warn(
          `[polish] word count further from target: ${currentWords} → ${polishedWords} (target ${targetWords}) for task ${taskId}, using original`,
        );
        return inputText;
      }
    }

    // All checks passed — store polished version
    const wordCount = polishedText.split(/\s+/).filter(Boolean).length;
    await supabaseAdmin.from('document_versions').insert({
      task_id: taskId,
      version: versionBase + 4,
      stage: 'polished',
      word_count: wordCount,
      content: polishedText,
    });

    console.log(`[polish] success for task ${taskId}, words ${currentWords} → ${polishedWords} (target ${targetMin}-${targetMax})`);
    return polishedText;
  } catch (err: any) {
    console.warn(`[polish] failed for task ${taskId}, delivering without polishing:`, err?.message || err);
    return inputText;
  }
}

// ─── Chart Enhancement (Claude + Chart DSL + QuickChart rendering) ──────────

function buildChartEnhancementSystemPrompt(targetWords?: number, specialRequirements?: string, outlineContent?: string): string {
  const { minWords, maxWords } = targetWords ? getWordCountRange(targetWords) : { minWords: 0, maxWords: Infinity };
  const wordBudgetRule = targetWords
    ? `\n- WORD COUNT BUDGET: After adding chart reference sentences and table captions, the main body word count (excluding [CHART_BEGIN]...[CHART_END] blocks and table rows) MUST remain between ${minWords} and ${maxWords} words. If adding reference sentences would push the count over the limit, shorten other body paragraphs to compensate — remove redundant elaboration or tighten phrasing, but keep all in-text citations.`
    : '';

  const contextSection = [
    specialRequirements?.trim()
      ? `\nASSIGNMENT CONTEXT — SPECIAL REQUIREMENTS (use these to judge whether visuals are expected):\n${specialRequirements.trim()}`
      : '',
    outlineContent?.trim()
      ? `\nPAPER OUTLINE (for context on structure and content type):\n${outlineContent.trim()}`
      : '',
  ].filter(Boolean).join('\n');

  return `You are an academic paper visualization specialist. Your task is to analyze a completed English academic paper and decide whether it genuinely benefits from charts and/or tables, then enhance it only when warranted.

VISUALIZATION DECISION FRAMEWORK:

Before adding anything, analyze whether this paper genuinely benefits from visual elements.

CHARTS / GRAPHS — add ONLY when at least one of these is true:
  a) The assignment requirements or special instructions explicitly ask for figures, charts, graphs, visual aids, or diagrams.
  b) The paper body contains real numerical data, statistics, survey results, or quantitative comparisons that would be clearer as a visualization.
  c) The paper analyzes measurable trends, distributions, or quantitative relationships across multiple variables.

DO NOT add charts when:
  - The paper is a purely argumentative essay, reflective writing, literary analysis, or philosophical discussion with no quantitative content.
  - The only way to make a chart would be to fabricate abstract "concept scores" or arbitrary percentages — this adds no real value.
  - A chart would merely restate what the text already says clearly.

If you add a chart, every data point MUST be derived from specific information already discussed in the paper. Do not invent data.

TABLES — the bar is lower; add when any of these is true:
  a) The paper compares multiple items, theories, cases, or methods across shared dimensions.
  b) The paper presents a framework or classification that is easier to scan in tabular form.
  c) The assignment requirements mention tables.

DO NOT add tables when:
  - The paper is a straightforward narrative with no comparative or categorical structure.

IF NEITHER CHARTS NOR TABLES ARE WARRANTED:
  Output the paper text exactly as-is, with zero modifications.

CHART RULES (only applicable if you decide to add charts):
- Add at most 2 charts. Chart data must be derived from information ALREADY discussed in the paper — statistics, comparisons, or referenced data. Do not invent data points that are not grounded in the paper's content.
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
- When adding figure/table reference sentences, you MAY shorten other body paragraphs to compensate for the added words. Remove redundant elaboration or tighten verbose phrasing, but keep all in-text citations intact.
- Do NOT add new arguments, evidence, or references that were not in the original paper.
- Do NOT use Markdown heading syntax (#), bold (**), or any other Markdown formatting in the paper body text.
- The paper's section headings, references section, and citation style must remain exactly as they were.${wordBudgetRule}
- Output the COMPLETE paper text — do not truncate or summarize.${contextSection}`;
}

interface ChartEnhancementResult {
  text: string;
  mediaMap: Map<string, RenderedChart>;
}

const POST_CHART_CONDENSE_TIMEOUT_MS = 600_000; // 10 minutes

async function postChartCondense(
  enhancedText: string,
  targetWords: number,
): Promise<string> {
  const { minWords, maxWords } = getWordCountRange(targetWords);
  const currentWords = countMainBodyWords(enhancedText);
  console.log(`[post-chart-condense] starting: current=${currentWords}, target range=${minWords}-${maxWords}`);

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    system: `You are an academic writing editor. The paper below has charts and tables embedded using [CHART_BEGIN]...[CHART_END] DSL blocks. The main body word count (excluding chart DSL blocks, table rows, title, and references) is currently ${currentWords} words, but it must be between ${minWords} and ${maxWords} words.

Condense the main body to fit within ${minWords}-${maxWords} words by:
1. Removing redundant elaboration and filler phrases
2. Merging sentences that say the same thing differently
3. Tightening verbose phrasing

ABSOLUTE CONSTRAINTS:
- Do NOT alter or remove ANY [CHART_BEGIN]...[CHART_END] blocks — reproduce them exactly
- Do NOT alter or remove ANY figure/table reference sentences (e.g. "As illustrated in Figure 1, ...")
- Do NOT alter ANY in-text citations or the References section
- Do NOT remove tables or table captions
- Do NOT use Markdown syntax
- Output the COMPLETE paper — no truncation, no preamble`,
    messages: [{ role: 'user', content: enhancedText }],
  });

  stream.on('error', (err: any) => {
    console.warn(`[post-chart-condense] stream error:`, err?.message || err);
  });

  const response = await Promise.race([
    stream.finalMessage(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('post-chart condense timeout')), POST_CHART_CONDENSE_TIMEOUT_MS),
    ),
  ]);

  const resp = response as any;
  const condensed = resp.content
    ?.filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n\n') || '';

  if (!condensed) {
    console.warn('[post-chart-condense] empty result, using original');
    return enhancedText;
  }

  const condensedWords = countMainBodyWords(condensed);
  console.log(`[post-chart-condense] done: ${currentWords} → ${condensedWords}`);
  return condensed;
}

async function enhanceWithCharts(
  verifiedText: string,
  paperTitle: string,
  researchQuestion: string,
  targetWords?: number,
  specialRequirements?: string,
  outlineContent?: string,
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
      system: buildChartEnhancementSystemPrompt(targetWords, specialRequirements, outlineContent),
      thinking: {
        type: 'adaptive',
      } as any,
      ...({ output_config: { effort: 'max' } } as any),
      messages: [
        {
          role: 'user',
          content: `Below is a completed academic paper titled "${paperTitle}" (research question: "${researchQuestion}"). First decide whether this paper genuinely needs charts and/or tables based on the visualization decision framework above. If it does, enhance accordingly. If not, output the paper unchanged.\n\n${verifiedText}`,
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

    // Safety check: Strip chart DSL blocks + table rows, then check word count.
    const cleanForCheck = rawText
      .replace(/\[CHART_BEGIN\][\s\S]*?\[CHART_END\]/g, '')
      .replace(/^\|[^\n]*\|$/gm, '')
      .trim();
    const originalWords = countMainBodyWords(verifiedText);
    const enhancedWords = countMainBodyWords(cleanForCheck);

    console.log(`[chart-enhance] body words: original=${originalWords}, enhanced=${enhancedWords}`);

    // Check if enhanced text is within target word range
    let finalRawText = rawText;
    if (targetWords) {
      const { minWords, maxWords } = getWordCountRange(targetWords);
      if (enhancedWords > maxWords || enhancedWords < minWords) {
        console.warn(
          `[chart-enhance] body ${enhancedWords} outside target range ${minWords}-${maxWords}, running safety-net condense`,
        );
        // Safety net: condense the enhanced text while keeping charts
        try {
          const condensed = await postChartCondense(rawText, targetWords);
          const condensedClean = condensed
            .replace(/\[CHART_BEGIN\][\s\S]*?\[CHART_END\]/g, '')
            .replace(/^\|[^\n]*\|$/gm, '')
            .trim();
          const condensedWords = countMainBodyWords(condensedClean);
          if (condensedWords >= minWords && condensedWords <= maxWords) {
            console.log(`[chart-enhance] safety-net condense succeeded: ${enhancedWords} → ${condensedWords}`);
            finalRawText = condensed;
          } else {
            console.warn(`[chart-enhance] safety-net condense still out of range (${condensedWords}), using original polished text`);
            return empty;
          }
        } catch (condenseErr: any) {
          console.warn(`[chart-enhance] safety-net condense failed:`, condenseErr?.message || condenseErr);
          return empty;
        }
      }
    } else {
      // Fallback: original ±8% check when no target words available
      if (originalWords > 0 && Math.abs(enhancedWords - originalWords) > originalWords * 0.08) {
        console.warn(
          `[chart-enhance] AI mutated text (original=${originalWords}, enhanced=${enhancedWords}), discarding`,
        );
        return empty;
      }
    }

    // Parse chart DSL → placeholders + chart specs (reuse revision parser)
    const { text: textWithPlaceholders, charts } = parseRevisionOutput(finalRawText);

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
    version: versionBase + 5,
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
}

/**
 * Generate citation report as a best-effort step AFTER the task is already
 * marked complete.  If this crashes (e.g. OpenAI stream disconnect through
 * sub2api/Cloudflare), the user still has their Word file and their credits
 * are already settled — the task will not be stuck at "delivering".
 */
async function generateAndStoreCitationReport(
  taskId: string,
  finalText: string,
  task: any,
  displayTitle: string,
  expiresAt: Date,
) {
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
    console.log(`[citation-report] task=${taskId} generated successfully`);
  } catch (reportErr) {
    const reason = reportErr instanceof Error ? reportErr.message : String(reportErr);
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
