import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import { startHumanizeJobAtomic } from './atomicOpsService';
import { storeGeneratedTaskFile, countMainBodyWords, getWordCountRange } from './writingService';
import { undetectableClient, type HumanizeTextResult } from '../lib/undetectable';
import { buildFormattedPaperDocBuffer } from './documentFormattingService';
import { recordAuditLog } from './auditLogService';
import { captureError } from '../lib/errorMonitor';
import { normalizeDeliveryPaperTitle } from './paperTitleService';
import { anthropic } from '../lib/anthropic';
import { extractReferenceEntries } from './paperQualityService';

const CONDENSE_TIMEOUT_MS = 900_000; // 15 minutes
const FORMAT_CHECK_TIMEOUT_MS = 600_000; // 10 minutes
const CONDENSE_RATIO = 0.72; // Condense to 72% of target — with 30-40% inflation lands near 100%

// ─── Condense & Format Check (Claude API) ───────────────────────────────────

function buildCondenseSystemPrompt(targetWords: number, currentWords: number): string {
  return `You are an academic writing editor specializing in concise writing. Condense the following academic paper to approximately ${targetWords} words in the main body (excluding title and references). Current main body: ${currentWords} words.

CONDENSING RULES:
1. Reduce to approximately ${targetWords} words.
2. Preserve argument structure and all key claims.
3. Remove redundant elaboration, filler phrases, unnecessary repetition.
4. Merge sentences that say the same thing differently.
5. Cut examples that merely restate an already-supported point.
6. Tighten verbose phrasing ("in order to" → "to", "due to the fact that" → "because").
7. Keep section headings exactly as-is.
8. Reduce proportionally across all sections.

ABSOLUTE CONSTRAINTS:
- Do NOT remove or alter ANY in-text citation "(Author, Year)" or "[N]"
- Do NOT remove or alter ANY reference entry — reproduce References section character-for-character
- If removing a sentence would orphan a citation, keep that sentence
- Do NOT use Markdown syntax
- Output the COMPLETE condensed paper with title, all sections, and full References
- No preamble, no commentary`;
}

function buildFormatCheckSystemPrompt(): string {
  return `You are a formatting quality checker for academic papers. The paper below was processed by a humanization tool and may have formatting artifacts. Fix formatting issues ONLY. Do NOT rewrite any content.

FIX THESE ONLY:
1. Broken paragraphs — sentences split across lines mid-sentence
2. Missing paragraph breaks — separate paragraphs merged into one
3. Broken citations — e.g. "(Smith, 202 4)" → "(Smith, 2024)"
4. Residual Markdown artifacts — any #, **, __, \`, -, * markers
5. Broken reference entries — split, merged, or spacing-corrupted entries
6. Doubled spaces, trailing whitespace
7. Section headings merged into previous paragraph

DO NOT:
- Rewrite any sentences
- Add new content
- Remove any content
- Change order of anything
- "Improve" writing style

Output the COMPLETE paper with formatting fixes. No Markdown. No preamble.`;
}

async function condensePaper(text: string, targetWordCount: number): Promise<string> {
  const currentWords = countMainBodyWords(text);
  console.log(`[humanize-condense] starting: current=${currentWords}, target=${targetWordCount}`);

  const stream = anthropic.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 64000,
    system: buildCondenseSystemPrompt(targetWordCount, currentWords),
    thinking: {
      type: 'adaptive',
    } as any,
    ...({ output_config: { effort: 'max' } } as any),
    messages: [
      {
        role: 'user',
        content: text,
      },
    ],
  } as any);

  const response = await Promise.race([
    stream.finalMessage(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('condense timeout')), CONDENSE_TIMEOUT_MS),
    ),
  ]);

  const resp = response as any;
  const condensed = resp.content
    ?.filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n\n') || '';

  console.log(
    `[humanize-condense] stop=${resp.stop_reason}, ` +
    `text_len=${condensed.length}, ` +
    `usage=${JSON.stringify(resp.usage ?? {})}`,
  );

  if (!condensed) {
    throw new Error('Claude returned empty text during condensing');
  }

  // Safety: reference count must be preserved
  const origRefs = extractReferenceEntries(text);
  const condensedRefs = extractReferenceEntries(condensed);
  if (condensedRefs.length < origRefs.length) {
    console.warn(`[humanize-condense] references dropped from ${origRefs.length} to ${condensedRefs.length}`);
    throw new Error(`Condensing dropped references: ${origRefs.length} → ${condensedRefs.length}`);
  }

  const condensedWords = countMainBodyWords(condensed);
  console.log(`[humanize-condense] success: ${currentWords} → ${condensedWords} words`);
  return condensed;
}

async function formatCheckPaper(text: string): Promise<string> {
  try {
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 64000,
      system: buildFormatCheckSystemPrompt(),
      thinking: {
        type: 'adaptive',
      } as any,
      ...({ output_config: { effort: 'max' } } as any),
      messages: [
        {
          role: 'user',
          content: text,
        },
      ],
    } as any);

    const response = await Promise.race([
      stream.finalMessage(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('format check timeout')), FORMAT_CHECK_TIMEOUT_MS),
      ),
    ]);

    const resp = response as any;
    const formatted = resp.content
      ?.filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n\n') || '';

    console.log(
      `[humanize-format] stop=${resp.stop_reason}, ` +
      `text_len=${formatted.length}, ` +
      `usage=${JSON.stringify(resp.usage ?? {})}`,
    );

    if (!formatted) {
      console.warn('[humanize-format] Claude returned empty text, using raw humanized text');
      return text;
    }

    return formatted;
  } catch (err: any) {
    console.warn('[humanize-format] format check failed, using raw humanized text:', err?.message || err);
    return text;
  }
}

// ─── Deps interface ─────────────────────────────────────────────────────────

interface ExecuteHumanizeDeps {
  humanizeText: (inputText: string) => Promise<HumanizeTextResult>;
  condensePaper: (text: string, targetWordCount: number) => Promise<string>;
  formatCheckPaper: (text: string) => Promise<string>;
  getTargetWords: (taskId: string) => Promise<number>;
  insertDocumentVersion: (payload: {
    task_id: string;
    version: number;
    stage: 'final';
    word_count: number;
    content: string;
  }) => Promise<void>;
  getConfigValue: (key: string) => Promise<any>;
  storeGeneratedTaskFile: typeof storeGeneratedTaskFile;
  settleCredits: (userId: string, amount: number) => Promise<unknown>;
  refundCredits: (userId: string, amount: number, refType: string, refId: string, note: string) => Promise<unknown>;
  updateHumanizeJob: (jobId: string, payload: Record<string, unknown>) => Promise<void>;
  updateTask: (taskId: string, payload: Record<string, unknown>) => Promise<void>;
  loadTaskMeta: (taskId: string) => Promise<{ title: string; course_code: string | null } | null>;
  insertTaskEvent: (payload: {
    task_id: string;
    event_type: string;
    detail: Record<string, unknown>;
  }) => Promise<void>;
  now: () => Date;
}

const defaultExecuteHumanizeDeps: ExecuteHumanizeDeps = {
  humanizeText: (inputText) => undetectableClient.humanizeText(inputText),
  condensePaper,
  formatCheckPaper,
  getTargetWords: async (taskId) => {
    const { data } = await supabaseAdmin
      .from('tasks')
      .select('target_words')
      .eq('id', taskId)
      .single();
    return data?.target_words || 1000;
  },
  insertDocumentVersion: async (payload) => {
    await supabaseAdmin.from('document_versions').insert(payload);
  },
  getConfigValue: getConfig,
  storeGeneratedTaskFile,
  settleCredits,
  refundCredits,
  updateHumanizeJob: async (jobId, payload) => {
    await supabaseAdmin.from('humanize_jobs').update(payload).eq('id', jobId);
  },
  updateTask: async (taskId, payload) => {
    await supabaseAdmin.from('tasks').update(payload).eq('id', taskId);
  },
  loadTaskMeta: async (taskId) => {
    const { data } = await supabaseAdmin
      .from('tasks')
      .select('title, course_code')
      .eq('id', taskId)
      .single();
    return data || null;
  },
  insertTaskEvent: async (payload) => {
    await supabaseAdmin.from('task_events').insert(payload);
  },
  now: () => new Date(),
};

export async function startHumanize(taskId: string, userId: string) {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) throw new AppError(404, '任务不存在。');
  if (task.status !== 'completed') throw new AppError(400, '只有已完成的任务才能发起降 AI。');

  // Determine input version
  const { data: lastSuccessJob } = await supabaseAdmin
    .from('humanize_jobs')
    .select('id')
    .eq('task_id', taskId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  let inputVersion;
  if (lastSuccessJob) {
    // Use the latest final version (from last humanize)
    const { data: doc } = await supabaseAdmin
      .from('document_versions')
      .select('*')
      .eq('task_id', taskId)
      .eq('stage', 'final')
      .order('version', { ascending: false })
      .limit(1)
      .single();
    inputVersion = doc;
  } else {
    // First time: use original final
    const { data: doc } = await supabaseAdmin
      .from('document_versions')
      .select('*')
      .eq('task_id', taskId)
      .eq('stage', 'final')
      .order('version', { ascending: true })
      .limit(1)
      .single();
    inputVersion = doc;
  }

  if (!inputVersion) throw new AppError(500, '找不到可用的正文版本。');

  const inputWordCount = inputVersion.word_count;
  const pricePerThousand = (await getConfig('humanize_price_per_1000')) || 250;
  const units = Math.ceil(inputWordCount / 1000);
  const cost = units * pricePerThousand;

  const result = await startHumanizeJobAtomic(taskId, userId, inputVersion.id, inputWordCount, cost);

  await recordAuditLog({
    actorUserId: userId,
    action: 'humanize.started',
    targetType: 'task',
    targetId: taskId,
    detail: {
      jobId: result.jobId,
      inputWordCount,
      frozenCredits: cost,
    },
  });

  // Async execution
  executeHumanize(taskId, userId, result.jobId, inputVersion.content, inputWordCount, cost).catch(err => {
    captureError(err, 'humanize.execute_async', { taskId, jobId: result.jobId, userId });
  });

  return result;
}

export async function executeHumanize(
  taskId: string,
  userId: string,
  jobId: string,
  inputText: string,
  wordCount: number,
  frozenCredits: number,
  deps: ExecuteHumanizeDeps = defaultExecuteHumanizeDeps,
) {
  try {
    // Step 1: Get target words and condense via Claude
    const targetWords = await deps.getTargetWords(taskId);
    const condensedTarget = Math.round(targetWords * CONDENSE_RATIO);
    console.log(`[humanize] task ${taskId}: target=${targetWords}, condenseTarget=${condensedTarget}, inputWords=${wordCount}`);

    const condensed = await deps.condensePaper(inputText, condensedTarget);
    const condensedWords = condensed.split(/\s+/).filter(Boolean).length;
    console.log(`[humanize] task ${taskId}: condensed to ${condensedWords} words`);

    // Step 2: Humanize via Undetectable AI
    const { documentId, output } = await deps.humanizeText(condensed);
    const humanized = output;
    const humanizedWords = humanized.split(/\s+/).filter(Boolean).length;
    console.log(`[humanize] task ${taskId}: humanized to ${humanizedWords} words (inflation: ${((humanizedWords / condensedWords - 1) * 100).toFixed(1)}%)`);

    // Step 3: Format check via Claude (best-effort)
    const formatted = await deps.formatCheckPaper(humanized);
    const newWordCount = formatted.split(/\s+/).filter(Boolean).length;

    // Step 4: Final word count check (warning only, does not block)
    const { minWords, maxWords } = getWordCountRange(targetWords);
    const mainBodyWords = countMainBodyWords(formatted);
    if (mainBodyWords < minWords || mainBodyWords > maxWords) {
      console.warn(
        `[humanize] task ${taskId}: final main body ${mainBodyWords} outside target range ${minWords}-${maxWords}`,
      );
    } else {
      console.log(`[humanize] task ${taskId}: final main body ${mainBodyWords} within range ${minWords}-${maxWords}`);
    }

    // Step 5: Store and deliver
    const taskMeta = await deps.loadTaskMeta(taskId);

    await deps.insertDocumentVersion({
      task_id: taskId,
      version: 100 + Math.floor(deps.now().getTime() / 1000),
      stage: 'final',
      word_count: newWordCount,
      content: formatted,
    });

    const retentionDays = (await deps.getConfigValue('result_file_retention_days')) || 3;
    const expiresAt = deps.now();
    expiresAt.setDate(expiresAt.getDate() + retentionDays);
    const displayTitle = normalizeDeliveryPaperTitle(taskMeta?.title, 'Academic Essay');

    const docBuffer = await buildFormattedPaperDocBuffer(formatted, {
      paperTitle: displayTitle,
      courseCode: taskMeta?.course_code || null,
    });
    const docPath = `${taskId}/humanized-${deps.now().getTime()}.docx`;

    await deps.storeGeneratedTaskFile({
      taskId,
      category: 'humanized_doc',
      originalName: 'humanized-paper.docx',
      storagePath: docPath,
      fileSize: docBuffer.length,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      expiresAtIso: expiresAt.toISOString(),
      body: docBuffer,
    });

    await deps.settleCredits(userId, frozenCredits);
    await deps.updateHumanizeJob(jobId, {
      status: 'completed',
      completed_at: deps.now().toISOString(),
    });

    await deps.updateTask(taskId, {
      stage: 'completed',
      updated_at: deps.now().toISOString(),
    });

    await deps.insertTaskEvent({
      task_id: taskId,
      event_type: 'humanize_completed',
      detail: {
        job_id: jobId,
        word_count: newWordCount,
        main_body_words: mainBodyWords,
        condensed_words: condensedWords,
        humanized_words: humanizedWords,
        provider: 'undetectable',
        provider_document_id: documentId,
        input_word_count: wordCount,
      },
    });

    await recordAuditLog({
      actorUserId: userId,
      action: 'humanize.completed',
      targetType: 'task',
      targetId: taskId,
      detail: {
        jobId,
        wordCount: newWordCount,
        condensedWords,
        humanizedWords,
      },
    });

  } catch (err: any) {
    try {
      await deps.refundCredits(userId, frozenCredits, 'humanize_job', jobId, `降 AI 失败退款：${frozenCredits} 积分`);
      await deps.updateHumanizeJob(jobId, {
        status: 'failed',
        failure_reason: `降 AI 处理失败，积分已退回。${err?.message ? `原因：${err.message}` : ''}`.trim(),
        refunded: true,
      });
    } catch {
      await deps.updateHumanizeJob(jobId, {
        status: 'failed',
        failure_reason: '降 AI 失败且退款异常，请联系客服。',
        refunded: false,
      });
    }

    await deps.updateTask(taskId, {
      stage: 'completed',
      updated_at: deps.now().toISOString(),
    });

    await deps.insertTaskEvent({
      task_id: taskId,
      event_type: 'humanize_failed',
      detail: { job_id: jobId, error: err.message },
    });

    await recordAuditLog({
      actorUserId: userId,
      action: 'humanize.failed',
      targetType: 'task',
      targetId: taskId,
      detail: {
        jobId,
        error: err?.message || 'unknown',
        refunded: true,
        frozenCredits,
      },
    });
  }
}
