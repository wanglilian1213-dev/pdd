import cron from 'node-cron';
import { supabaseAdmin } from './lib/supabase';
import { refundCredits } from './services/walletService';
import { failTask } from './services/taskService';
import { deleteExpiredFiles } from './services/fileService';
import { getConfig } from './services/configService';
import { captureError } from './lib/errorMonitor';
import { cleanupTaskOpenAIFiles } from './services/materialInputService';

export interface CleanupDeps {
  cleanupStuckTasks: () => Promise<void>;
  cleanupExpiredFiles: () => Promise<void>;
  cleanupExpiredMaterials: () => Promise<void>;
}

export interface CleanupLogger {
  log: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

const defaultLogger: CleanupLogger = {
  log: (message: string) => console.log(message),
  error: (message: string, error?: unknown) => console.error(message, error),
};

const AUTO_CLEANUP_STAGES = new Set([
  'uploading',
  'outline_generating',
  'writing',
  'word_calibrating',
  'citation_checking',
  'delivering',
  'humanizing',
]);

export function isAutoCleanupStage(stage: string): boolean {
  return AUTO_CLEANUP_STAGES.has(stage);
}

async function cleanupStuckTasks() {
  const timeoutMinutes = (await getConfig('stuck_task_timeout_minutes')) || 30;
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

async function cleanupExpiredMaterials() {
  const retentionDays = (await getConfig('material_retention_days')) || 3;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const { data: oldMaterials } = await supabaseAdmin
    .from('task_files')
    .select('id, storage_path, openai_file_id')
    .eq('category', 'material')
    .lt('created_at', cutoff.toISOString());

  if (!oldMaterials || oldMaterials.length === 0) {
    console.log('[cleanup] No expired materials found.');
    return;
  }

  // Collect unique task IDs from expired materials for OpenAI file cleanup
  const taskIdsToClean = new Set<string>();

  for (const file of oldMaterials) {
    if (file.openai_file_id) {
      // Get the task_id for this file to clean up OpenAI files
      const { data: fileRecord } = await supabaseAdmin
        .from('task_files')
        .select('task_id')
        .eq('id', file.id)
        .single();
      if (fileRecord) {
        taskIdsToClean.add(fileRecord.task_id);
      }
    }
    await supabaseAdmin.storage.from('task-files').remove([file.storage_path]);
    await supabaseAdmin.from('task_files').delete().eq('id', file.id);
  }

  // Clean up any orphaned OpenAI files for affected tasks
  for (const taskId of taskIdsToClean) {
    await cleanupTaskOpenAIFiles(taskId).catch((err) => {
      captureError(err, 'cleanup.expired_material_openai_files', { taskId });
    });
  }

  console.log(`[cleanup] Cleaned up ${oldMaterials.length} expired material files.`);
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
  logger.log('[cleanup] Cleanup service started. Scheduled for 3:00 AM daily.');
  scheduleCleanup(deps, logger);
  void runInitialCleanup(deps, logger);
}
