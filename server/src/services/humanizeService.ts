import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import { startHumanizeJobAtomic } from './atomicOpsService';
import { storeGeneratedTaskFile } from './writingService';
import { undetectableClient, type HumanizeTextResult } from '../lib/undetectable';
import { buildFormattedPaperDocBuffer } from './documentFormattingService';
import { recordAuditLog } from './auditLogService';
import { captureError } from '../lib/errorMonitor';
import { normalizeDeliveryPaperTitle } from './paperTitleService';

interface ExecuteHumanizeDeps {
  humanizeText: (inputText: string) => Promise<HumanizeTextResult>;
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
    const { documentId, output } = await deps.humanizeText(inputText);
    const humanized = output;
    const newWordCount = humanized.split(/\s+/).filter(Boolean).length;
    const taskMeta = await deps.loadTaskMeta(taskId);

    await deps.insertDocumentVersion({
      task_id: taskId,
      version: 100 + Math.floor(deps.now().getTime() / 1000),
      stage: 'final',
      word_count: newWordCount,
      content: humanized,
    });

    const retentionDays = (await deps.getConfigValue('result_file_retention_days')) || 3;
    const expiresAt = deps.now();
    expiresAt.setDate(expiresAt.getDate() + retentionDays);
    const displayTitle = normalizeDeliveryPaperTitle(taskMeta?.title, 'Academic Essay');

    const docBuffer = await buildFormattedPaperDocBuffer(humanized, {
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
