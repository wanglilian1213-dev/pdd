import cron from 'node-cron';
import { supabaseAdmin } from './lib/supabase';
import { refundCredits } from './services/walletService';
import { failTask } from './services/taskService';
import { deleteExpiredFiles } from './services/fileService';
import { getConfig } from './services/configService';
import { captureError } from './lib/errorMonitor';
import { openai } from './lib/openai';

export interface CleanupDeps {
  cleanupStuckTasks: () => Promise<void>;
  cleanupExpiredFiles: () => Promise<void>;
  cleanupExpiredMaterials: () => Promise<void>;
}

export interface CleanupLogger {
  log: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

export interface ExpiredMaterialRecord {
  id: string;
  taskId: string | null;
  storagePath: string;
  openAiFileId: string | null;
}

export interface TaskStatusRecord {
  id: string;
  status: string | null;
}

export interface CleanupExpiredMaterialsDeps {
  getRetentionDays: () => Promise<number | null>;
  listExpiredMaterials: (cutoffIso: string) => Promise<ExpiredMaterialRecord[]>;
  listTasksByIds: (taskIds: string[]) => Promise<TaskStatusRecord[]>;
  deleteOpenAiFile: (fileId: string) => Promise<void>;
  removeStorageFile: (storagePath: string) => Promise<void>;
  deleteTaskFileRecord: (fileId: string) => Promise<void>;
  captureCleanupError: (error: unknown, context: string, extra?: Record<string, unknown>) => void;
  logger: CleanupLogger;
}

const defaultLogger: CleanupLogger = {
  log: (message: string) => console.log(message),
  error: (message: string, error?: unknown) => console.error(message, error),
};

export const DEFAULT_STUCK_TASK_TIMEOUT_MINUTES = 45;
const FINISHED_TASK_STATUSES = new Set(['completed', 'failed']);

const AUTO_CLEANUP_STAGES = new Set([
  'uploading',
  'outline_generating',
  'outline_regenerating',
  'writing',
  'word_calibrating',
  'citation_checking',
  'delivering',
  'humanizing',
]);

export function isAutoCleanupStage(stage: string): boolean {
  return AUTO_CLEANUP_STAGES.has(stage);
}

export function isFinishedTaskStatus(status: string | null | undefined): boolean {
  return status != null && FINISHED_TASK_STATUSES.has(status);
}

async function cleanupStuckTasks() {
  const timeoutMinutes = (await getConfig('stuck_task_timeout_minutes')) || DEFAULT_STUCK_TASK_TIMEOUT_MINUTES;
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  const { data: stuckTasks } = await supabaseAdmin
    .from('tasks')
    .select('id, user_id, stage, frozen_credits')
    .eq('status', 'processing')
    .lt('updated_at', cutoff);

  if (!stuckTasks || stuckTasks.length === 0) {
    console.log('[cleanup] No stuck tasks found.');
    return;
  }

  for (const task of stuckTasks) {
    if (!isAutoCleanupStage(task.stage)) {
      console.log(`[cleanup] Skipping task ${task.id} at stage ${task.stage} because it is waiting for user action.`);
      continue;
    }

    console.log(`[cleanup] Processing stuck task ${task.id} at stage ${task.stage}`);

    const paidStages = ['writing', 'word_calibrating', 'citation_checking', 'delivering'];
    const needsRefund = paidStages.includes(task.stage) && task.frozen_credits > 0;

    if (needsRefund) {
      try {
        await refundCredits(task.user_id, task.frozen_credits, 'task', task.id, `卡住任务自动退款：${task.frozen_credits} 积分`);
        await failTask(task.id, task.stage, '任务处理超时，积分已自动退回。请重新创建任务。', true);
      } catch (err) {
        console.error(`[cleanup] Refund failed for task ${task.id}:`, err);
        await failTask(task.id, task.stage, '任务超时，退款异常，请联系客服。', false);
      }
    } else if (task.stage === 'humanizing') {
      const { data: pendingJobs } = await supabaseAdmin
        .from('humanize_jobs')
        .select('id, frozen_credits')
        .eq('task_id', task.id)
        .eq('status', 'processing');

      for (const job of pendingJobs || []) {
        try {
          await refundCredits(task.user_id, job.frozen_credits, 'humanize_job', job.id, `降 AI 超时退款：${job.frozen_credits} 积分`);
          await supabaseAdmin.from('humanize_jobs').update({
            status: 'failed',
            failure_reason: '处理超时，积分已退回。',
            refunded: true,
          }).eq('id', job.id);
        } catch (err) {
          console.error(`[cleanup] Humanize refund failed for job ${job.id}:`, err);
        }
      }

      await supabaseAdmin.from('tasks').update({
        stage: 'completed',
        updated_at: new Date().toISOString(),
      }).eq('id', task.id);
    } else {
      await failTask(task.id, task.stage, '任务处理超时，请重新创建任务。', false);
    }
  }
}

async function cleanupExpiredFiles() {
  const count = await deleteExpiredFiles();
  console.log(`[cleanup] Deleted ${count} expired files.`);
}

function createExpiredMaterialsDeps(
  logger: CleanupLogger = defaultLogger,
): CleanupExpiredMaterialsDeps {
  return {
    getRetentionDays: async () => getConfig('material_retention_days'),
    listExpiredMaterials: async (cutoffIso: string) => {
      const { data } = await supabaseAdmin
        .from('task_files')
        .select('id, task_id, storage_path, openai_file_id')
        .eq('category', 'material')
        .lt('created_at', cutoffIso);

      return (data || []).map((file) => ({
        id: file.id,
        taskId: file.task_id,
        storagePath: file.storage_path,
        openAiFileId: file.openai_file_id,
      }));
    },
    listTasksByIds: async (taskIds: string[]) => {
      if (taskIds.length === 0) {
        return [];
      }

      const { data } = await supabaseAdmin
        .from('tasks')
        .select('id, status')
        .in('id', taskIds);

      return (data || []).map((task) => ({
        id: task.id,
        status: task.status,
      }));
    },
    deleteOpenAiFile: async (fileId: string) => {
      await openai.files.del(fileId);
    },
    removeStorageFile: async (storagePath: string) => {
      await supabaseAdmin.storage.from('task-files').remove([storagePath]);
    },
    deleteTaskFileRecord: async (fileId: string) => {
      await supabaseAdmin.from('task_files').delete().eq('id', fileId);
    },
    captureCleanupError: captureError,
    logger,
  };
}

export async function cleanupExpiredMaterialsWithDeps(
  deps: CleanupExpiredMaterialsDeps,
  now: Date = new Date(),
) {
  const retentionDays = (await deps.getRetentionDays()) || 3;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const oldMaterials = await deps.listExpiredMaterials(cutoff.toISOString());

  if (oldMaterials.length === 0) {
    deps.logger.log('[cleanup] No expired materials found.');
    return;
  }

  const taskStatuses = new Map(
    (await deps.listTasksByIds(
      [...new Set(oldMaterials.map((file) => file.taskId).filter((taskId): taskId is string => Boolean(taskId)))],
    )).map((task) => [task.id, task.status]),
  );

  const eligibleMaterials = oldMaterials.filter((file) => isFinishedTaskStatus(file.taskId ? taskStatuses.get(file.taskId) : null));
  const skippedCount = oldMaterials.length - eligibleMaterials.length;

  if (skippedCount > 0) {
    deps.logger.log(`[cleanup] Skipped ${skippedCount} expired material files because their tasks are not finished yet.`);
  }

  if (eligibleMaterials.length === 0) {
    deps.logger.log('[cleanup] No expired materials eligible for cleanup.');
    return;
  }

  for (const file of eligibleMaterials) {
    // 1. Delete OpenAI file first (while we still have the ID)
    if (file.openAiFileId) {
      try {
        await deps.deleteOpenAiFile(file.openAiFileId);
      } catch (err) {
        deps.captureCleanupError(err, 'cleanup.expired_material_openai_delete', { fileId: file.openAiFileId });
      }
    }
    // 2. Delete from Supabase storage
    await deps.removeStorageFile(file.storagePath);
    // 3. Delete DB row last
    await deps.deleteTaskFileRecord(file.id);
  }

  deps.logger.log(`[cleanup] Cleaned up ${eligibleMaterials.length} expired material files.`);
}

async function cleanupExpiredMaterials() {
  await cleanupExpiredMaterialsWithDeps(createExpiredMaterialsDeps());
}

export function createDefaultCleanupDeps(): CleanupDeps {
  return {
    cleanupStuckTasks,
    cleanupExpiredFiles,
    cleanupExpiredMaterials,
  };
}

export async function runCleanupCycle(
  deps: CleanupDeps = createDefaultCleanupDeps(),
) {
  await deps.cleanupStuckTasks();
  await deps.cleanupExpiredFiles();
  await deps.cleanupExpiredMaterials();
}

export async function runInitialCleanup(
  deps: CleanupDeps = createDefaultCleanupDeps(),
  logger: CleanupLogger = defaultLogger,
) {
  logger.log('[cleanup] Running initial cleanup...');
  try {
    await runCleanupCycle(deps);
    logger.log('[cleanup] Initial cleanup completed.');
  } catch (err) {
    logger.error('[cleanup] Initial cleanup failed:', err);
    captureError(err, 'cleanup.initial');
  }
}

export function scheduleCleanup(
  deps: CleanupDeps = createDefaultCleanupDeps(),
  logger: CleanupLogger = defaultLogger,
) {
  return cron.schedule('0 3 * * *', async () => {
    logger.log('[cleanup] Starting daily cleanup...');
    try {
      await runCleanupCycle(deps);
      logger.log('[cleanup] Daily cleanup completed.');
    } catch (err) {
      logger.error('[cleanup] Cleanup failed:', err);
      captureError(err, 'cleanup.scheduled');
    }
  });
}

export function startCleanupService(
  deps: CleanupDeps = createDefaultCleanupDeps(),
  logger: CleanupLogger = defaultLogger,
) {
  logger.log('[cleanup] ENTRYPOINT verified: running dedicated cleanup service process.');
  logger.log('[cleanup] Cleanup service started. Scheduled for 3:00 AM daily.');
  scheduleCleanup(deps, logger);
  void runInitialCleanup(deps, logger);
}
