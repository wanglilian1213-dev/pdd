import cron from 'node-cron';
import { supabaseAdmin } from './lib/supabase';
import { refundCredits } from './services/walletService';
import { failTask } from './services/taskService';
import { deleteExpiredFiles } from './services/fileService';
import { getConfig } from './services/configService';
import { captureError } from './lib/errorMonitor';

export interface CleanupDeps {
  cleanupStuckTasks: () => Promise<void>;
  cleanupStuckRevisions: () => Promise<void>;
  cleanupStuckScorings: () => Promise<void>;
  cleanupStuckHumanizeJobs: () => Promise<void>;
  cleanupExpiredFiles: () => Promise<void>;
  cleanupExpiredMaterials: () => Promise<void>;
  cleanupExpiredScoringMaterials: () => Promise<void>;
  cleanupExpiredScoringReports: () => Promise<void>;
}

export interface CleanupLogger {
  log: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

export interface ExpiredMaterialRecord {
  id: string;
  taskId: string | null;
  storagePath: string;
}

export interface TaskStatusRecord {
  id: string;
  status: string | null;
}

export interface CleanupExpiredMaterialsDeps {
  getRetentionDays: () => Promise<number | null>;
  listExpiredMaterials: (cutoffIso: string) => Promise<ExpiredMaterialRecord[]>;
  listTasksByIds: (taskIds: string[]) => Promise<TaskStatusRecord[]>;
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
  'polishing',
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

    const paidStages = ['writing', 'word_calibrating', 'citation_checking', 'polishing', 'delivering'];
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

async function cleanupStuckRevisions() {
  const timeoutMinutes =
    (await getConfig('stuck_task_timeout_minutes')) || DEFAULT_STUCK_TASK_TIMEOUT_MINUTES;
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  const { data: stuckRevisions } = await supabaseAdmin
    .from('revisions')
    .select('id, user_id, frozen_credits, refunded')
    .eq('status', 'processing')
    .lt('updated_at', cutoff);

  if (!stuckRevisions || stuckRevisions.length === 0) {
    console.log('[cleanup] No stuck revisions found.');
    return;
  }

  for (const revision of stuckRevisions) {
    console.log(`[cleanup] Processing stuck revision ${revision.id}`);

    if (!revision.refunded && revision.frozen_credits > 0) {
      try {
        await refundCredits(
          revision.user_id,
          revision.frozen_credits,
          'revision',
          revision.id,
          `卡住修改自动退款：${revision.frozen_credits} 积分`,
        );
        await supabaseAdmin
          .from('revisions')
          .update({
            status: 'failed',
            failure_reason: '修改处理超时，积分已自动退回。请重新提交。',
            refunded: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', revision.id);
      } catch (err) {
        console.error(`[cleanup] Refund failed for revision ${revision.id}:`, err);
        await supabaseAdmin
          .from('revisions')
          .update({
            status: 'failed',
            failure_reason: '修改超时，退款异常，请联系客服。',
            updated_at: new Date().toISOString(),
          })
          .eq('id', revision.id);
      }
    } else {
      // 没冻结积分或已退过款，直接标记失败
      await supabaseAdmin
        .from('revisions')
        .update({
          status: 'failed',
          failure_reason: '修改处理超时，请重新提交。',
          updated_at: new Date().toISOString(),
        })
        .eq('id', revision.id);
    }
  }
}

async function cleanupStuckScorings() {
  const timeoutMinutes =
    (await getConfig('stuck_task_timeout_minutes')) || DEFAULT_STUCK_TASK_TIMEOUT_MINUTES;
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  // 覆盖 initializing + processing 两个状态
  // initializing：还没冻结过积分 → 不需要 refund，只清文件 + 标失败
  // processing：可能已经冻结 → 按原逻辑 refund + 标失败
  const { data: stuckScorings } = await supabaseAdmin
    .from('scorings')
    .select('id, user_id, status, frozen_credits, refunded')
    .in('status', ['initializing', 'processing'])
    .lt('updated_at', cutoff);

  if (!stuckScorings || stuckScorings.length === 0) {
    console.log('[cleanup] No stuck scorings found.');
    return;
  }

  for (const scoring of stuckScorings) {
    console.log(`[cleanup] Processing stuck scoring ${scoring.id} (status=${scoring.status})`);

    // initializing 阶段卡住：没冻结过积分，只需清理 Storage + 标失败
    if (scoring.status === 'initializing' || scoring.frozen_credits === 0) {
      await cleanupScoringMaterialsForId(scoring.id);
      await supabaseAdmin
        .from('scorings')
        .update({
          status: 'failed',
          failure_reason: '评审准备超时，请重新提交。',
          updated_at: new Date().toISOString(),
        })
        .eq('id', scoring.id);
      continue;
    }

    // processing 阶段卡住：已冻结过积分，退款后标失败
    if (!scoring.refunded && scoring.frozen_credits > 0) {
      try {
        await refundCredits(
          scoring.user_id,
          scoring.frozen_credits,
          'scoring',
          scoring.id,
          `卡住评审自动退款：${scoring.frozen_credits} 积分`,
        );
        await supabaseAdmin
          .from('scorings')
          .update({
            status: 'failed',
            failure_reason: '评审处理超时，积分已自动退回。请重新提交。',
            refunded: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', scoring.id);
      } catch (err) {
        console.error(`[cleanup] Refund failed for scoring ${scoring.id}:`, err);
        await supabaseAdmin
          .from('scorings')
          .update({
            status: 'failed',
            failure_reason: '评审超时，退款异常，请联系客服。',
            updated_at: new Date().toISOString(),
          })
          .eq('id', scoring.id);
      }
    } else {
      // 已退过款，直接标记失败
      await supabaseAdmin
        .from('scorings')
        .update({
          status: 'failed',
          failure_reason: '评审处理超时，请重新提交。',
          updated_at: new Date().toISOString(),
        })
        .eq('id', scoring.id);
    }
  }
}

/**
 * 卡死的 humanize_jobs 兜底清理（2026-04-17 新增）。
 *
 * 背景：
 *   - cleanupStuckTasks 第 107-130 行的 humanizing 分支是死代码，
 *     因为外层只查 status='processing'，但降 AI 启动时 task.status 始终保持 'completed'，
 *     所以那条分支永远不会被触发；卡死的 humanize_jobs 会永久冻结积分。
 *   - 本函数走独立扫描：直接查 humanize_jobs.status='processing' AND created_at < cutoff。
 *
 * 数据细节：
 *   - humanize_jobs 表没有 updated_at / user_id 字段，所以用 created_at 算超时，user_id 必须 JOIN tasks 拿。
 *   - 退款必须先校验 refunded=false 且 frozen_credits>0，避免重复退款。
 *   - acknowledged 默认 false → 用户切回工作台能在 step 7 看到失败提示和退款说明。
 */
async function cleanupStuckHumanizeJobs() {
  const timeoutMinutes =
    (await getConfig('stuck_task_timeout_minutes')) || DEFAULT_STUCK_TASK_TIMEOUT_MINUTES;
  // humanize_jobs 没有 updated_at，用 created_at 作为参考；降 AI 实际耗时约 10 分钟，45 分钟 cutoff 留足缓冲
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  const { data: stuckJobs } = await supabaseAdmin
    .from('humanize_jobs')
    .select('id, task_id, frozen_credits, refunded')
    .eq('status', 'processing')
    .lt('created_at', cutoff);

  if (!stuckJobs || stuckJobs.length === 0) {
    console.log('[cleanup] No stuck humanize jobs found.');
    return;
  }

  for (const job of stuckJobs) {
    console.log(`[cleanup] Processing stuck humanize job ${job.id}`);

    // humanize_jobs 没有 user_id 字段，必须 JOIN tasks 拿（保持项目 2 步查询惯例，不用 PostgREST !inner）
    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('user_id, stage')
      .eq('id', job.task_id)
      .maybeSingle();

    if (!task) {
      console.warn(
        `[cleanup] Stuck humanize job ${job.id} references missing task ${job.task_id}, skipping.`,
      );
      continue;
    }

    try {
      // 只在没退过款且确实有冻结时退（避免重复退款）
      if (!job.refunded && job.frozen_credits > 0) {
        await refundCredits(
          task.user_id,
          job.frozen_credits,
          'humanize_job',
          job.id,
          `卡死降 AI 自动退款：${job.frozen_credits} 积分`,
        );
      }

      await supabaseAdmin
        .from('humanize_jobs')
        .update({
          status: 'failed',
          failure_reason: '降 AI 处理超时，积分已自动退回。',
          refunded: true,
          // acknowledged 默认 false → 用户下次切回工作台能看到这条失败 + 退款说明
        })
        .eq('id', job.id);

      // 把 task.stage 改回 completed（如果还是 humanizing 残留）
      if (task.stage === 'humanizing') {
        await supabaseAdmin
          .from('tasks')
          .update({
            stage: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.task_id);
      }
    } catch (err) {
      console.error(`[cleanup] Stuck humanize refund failed for job ${job.id}:`, err);
    }
  }
}

/**
 * 把某个 scoring 的所有 material 文件从 Storage + DB 清掉。
 * 用于 initializing 阶段卡死的清理，或者 2026-04-16 新增的过期 material 清理。
 */
async function cleanupScoringMaterialsForId(scoringId: string) {
  const { data: files } = await supabaseAdmin
    .from('scoring_files')
    .select('id, storage_path')
    .eq('scoring_id', scoringId)
    .eq('category', 'material');

  if (!files || files.length === 0) return;

  const paths = files.map((f) => f.storage_path).filter(Boolean) as string[];
  if (paths.length > 0) {
    try {
      await supabaseAdmin.storage.from('task-files').remove(paths);
    } catch (err) {
      captureError(err, 'cleanup.scoring_storage_remove_failed', { scoringId });
    }
  }

  try {
    await supabaseAdmin
      .from('scoring_files')
      .delete()
      .eq('scoring_id', scoringId)
      .eq('category', 'material');
  } catch (err) {
    captureError(err, 'cleanup.scoring_files_delete_failed', { scoringId });
  }
}

/**
 * 过期 scoring 材料清理（2026-04-16 新增，补之前 cleanupExpiredMaterials 只扫 task_files 的漏洞）。
 * 规则：scoring_files.category='material' 且 created_at > retention_days 天前，
 * 对应 scoring 是 'completed' | 'failed' 终态时才删（processing / initializing 的保留）。
 */
async function cleanupExpiredScoringMaterials() {
  const retentionDays = (await getConfig('material_retention_days')) || 3;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: oldFiles } = await supabaseAdmin
    .from('scoring_files')
    .select('id, scoring_id, storage_path')
    .eq('category', 'material')
    .lt('created_at', cutoff);

  if (!oldFiles || oldFiles.length === 0) {
    console.log('[cleanup] No expired scoring materials found.');
    return;
  }

  const scoringIds = [...new Set(oldFiles.map((f) => f.scoring_id).filter(Boolean))] as string[];
  const { data: scorings } = await supabaseAdmin
    .from('scorings')
    .select('id, status')
    .in('id', scoringIds);

  const finishedIds = new Set(
    (scorings || [])
      .filter((s) => s.status === 'completed' || s.status === 'failed')
      .map((s) => s.id),
  );

  const eligible = oldFiles.filter((f) => finishedIds.has(f.scoring_id));
  const skipped = oldFiles.length - eligible.length;

  if (skipped > 0) {
    console.log(`[cleanup] Skipped ${skipped} scoring materials (scoring not finished yet).`);
  }

  if (eligible.length === 0) return;

  for (const f of eligible) {
    try {
      await supabaseAdmin.storage.from('task-files').remove([f.storage_path]);
    } catch (err) {
      captureError(err, 'cleanup.scoring_material_storage_remove_failed', { scoringId: f.scoring_id, fileId: f.id });
    }
    try {
      await supabaseAdmin.from('scoring_files').delete().eq('id', f.id);
    } catch (err) {
      captureError(err, 'cleanup.scoring_material_db_delete_failed', { scoringId: f.scoring_id, fileId: f.id });
    }
  }

  console.log(`[cleanup] Cleaned up ${eligible.length} expired scoring materials.`);
}

/**
 * 过期 scoring PDF 报告清理（2026-04-16 新增）。
 * 规则：scoring_files.category='report' 且 expires_at < now。
 */
async function cleanupExpiredScoringReports() {
  const { data: expired } = await supabaseAdmin
    .from('scoring_files')
    .select('id, scoring_id, storage_path, expires_at')
    .eq('category', 'report')
    .not('expires_at', 'is', null)
    .lt('expires_at', new Date().toISOString());

  if (!expired || expired.length === 0) {
    console.log('[cleanup] No expired scoring reports found.');
    return;
  }

  for (const f of expired) {
    try {
      await supabaseAdmin.storage.from('task-files').remove([f.storage_path]);
    } catch (err) {
      captureError(err, 'cleanup.scoring_report_storage_remove_failed', { scoringId: f.scoring_id, fileId: f.id });
    }
    try {
      await supabaseAdmin.from('scoring_files').delete().eq('id', f.id);
    } catch (err) {
      captureError(err, 'cleanup.scoring_report_db_delete_failed', { scoringId: f.scoring_id, fileId: f.id });
    }
  }

  console.log(`[cleanup] Cleaned up ${expired.length} expired scoring reports.`);
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
        .select('id, task_id, storage_path')
        .eq('category', 'material')
        .lt('created_at', cutoffIso);

      return (data || []).map((file) => ({
        id: file.id,
        taskId: file.task_id,
        storagePath: file.storage_path,
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
    // 1. Delete from Supabase storage
    await deps.removeStorageFile(file.storagePath);
    // 2. Delete DB row last
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
    cleanupStuckRevisions,
    cleanupStuckScorings,
    cleanupStuckHumanizeJobs,
    cleanupExpiredFiles,
    cleanupExpiredMaterials,
    cleanupExpiredScoringMaterials,
    cleanupExpiredScoringReports,
  };
}

export async function runCleanupCycle(
  deps: CleanupDeps = createDefaultCleanupDeps(),
) {
  await deps.cleanupStuckTasks();
  await deps.cleanupStuckRevisions();
  await deps.cleanupStuckScorings();
  await deps.cleanupStuckHumanizeJobs();
  await deps.cleanupExpiredFiles();
  await deps.cleanupExpiredMaterials();
  await deps.cleanupExpiredScoringMaterials();
  await deps.cleanupExpiredScoringReports();
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
