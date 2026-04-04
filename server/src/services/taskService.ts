import { supabaseAdmin } from '../lib/supabase';
import { AppError, ActiveTaskExistsError } from '../lib/errors';
import { normalizeCitationStyle } from './citationStyleService';

interface DiscardPendingTaskDeps {
  loadTask: (taskId: string, userId: string) => Promise<{
    id: string;
    user_id: string;
    stage: string;
    status: string;
    frozen_credits: number;
  } | null>;
  listTaskFiles: (taskId: string) => Promise<Array<{ storage_path: string }>>;
  removeStoragePaths: (paths: string[]) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
}

export async function createTask(userId: string, title: string, specialRequirements: string) {
  const { data: activeTask } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .single();

  if (activeTask) {
    throw new ActiveTaskExistsError();
  }

  const { data: task, error } = await supabaseAdmin
    .from('tasks')
    .insert({
      user_id: userId,
      title: title || '未命名任务',
      stage: 'uploading',
      status: 'processing',
      special_requirements: specialRequirements || '',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new ActiveTaskExistsError();
    }
    throw new AppError(500, '创建任务失败，请稍后重试。');
  }

  return task;
}

export async function getTask(taskId: string, userId: string) {
  const { data: task, error } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (error || !task) {
    throw new AppError(404, '任务不存在。');
  }

  const [files, outlines, latestDoc, humanizeJobs] = await Promise.all([
    supabaseAdmin.from('task_files').select('*').eq('task_id', taskId).order('created_at'),
    supabaseAdmin.from('outline_versions').select('*').eq('task_id', taskId).order('version'),
    supabaseAdmin.from('document_versions').select('*').eq('task_id', taskId).order('version', { ascending: false }).limit(1),
    supabaseAdmin.from('humanize_jobs').select('*').eq('task_id', taskId).order('created_at', { ascending: false }),
  ]);

  return {
    ...task,
    citation_style: normalizeCitationStyle((task as { citation_style?: string | null }).citation_style),
    files: files.data || [],
    outlines: (outlines.data || []).map((outline) => ({
      ...outline,
      citation_style: normalizeCitationStyle((outline as { citation_style?: string | null }).citation_style),
    })),
    latestDocument: latestDoc.data?.[0] || null,
    humanizeJobs: humanizeJobs.data || [],
  };
}

export async function getCurrentTask(userId: string) {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .single();

  if (!task) {
    return null;
  }

  return getTask(task.id, userId);
}

export async function discardPendingTaskWithDeps(
  taskId: string,
  userId: string,
  deps: DiscardPendingTaskDeps,
) {
  const task = await deps.loadTask(taskId, userId);

  if (!task) {
    throw new AppError(404, '任务不存在。');
  }

  const discardableStages = ['uploading', 'outline_generating', 'outline_ready'];
  if (task.status !== 'processing' || !discardableStages.includes(task.stage)) {
    throw new AppError(400, '当前任务已经进入正文流程，不能直接放弃。');
  }

  if (task.frozen_credits > 0) {
    throw new AppError(400, '当前任务已经冻结积分，不能直接放弃。');
  }

  const files = await deps.listTaskFiles(taskId);
  const storagePaths = files
    .map((file) => file.storage_path)
    .filter(Boolean);

  if (storagePaths.length > 0) {
    await deps.removeStoragePaths(storagePaths);
  }

  await deps.deleteTask(taskId);
}

export async function discardPendingTask(taskId: string, userId: string) {
  return discardPendingTaskWithDeps(taskId, userId, {
    loadTask: async (currentTaskId, currentUserId) => {
      const { data } = await supabaseAdmin
        .from('tasks')
        .select('id, user_id, stage, status, frozen_credits')
        .eq('id', currentTaskId)
        .eq('user_id', currentUserId)
        .single();

      return data || null;
    },
    listTaskFiles: async (currentTaskId) => {
      const { data, error } = await supabaseAdmin
        .from('task_files')
        .select('storage_path')
        .eq('task_id', currentTaskId);

      if (error) {
        throw new AppError(500, '读取任务文件失败，请稍后重试。');
      }

      return data || [];
    },
    removeStoragePaths: async (paths) => {
      const { error } = await supabaseAdmin.storage
        .from('task-files')
        .remove(paths);

      if (error) {
        throw new AppError(500, '清理任务文件失败，请稍后重试。');
      }
    },
    deleteTask,
  });
}

export async function getTaskList(userId: string, status?: string, limit = 20, offset = 0) {
  let query = supabaseAdmin
    .from('tasks')
    .select('id, title, paper_title, research_question, stage, status, target_words, frozen_credits, failure_stage, failure_reason, refunded, created_at, completed_at, updated_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new AppError(500, '获取任务列表失败。');
  }

  return { tasks: data || [], total: count || 0 };
}

export async function updateTaskStage(taskId: string, stage: string, extraFields: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin
    .from('tasks')
    .update({ stage, updated_at: new Date().toISOString(), ...extraFields })
    .eq('id', taskId);

  if (error) {
    throw new AppError(500, '任务状态更新失败。');
  }
}

export async function failTask(taskId: string, failureStage: string, failureReason: string, refunded: boolean) {
  const { error } = await supabaseAdmin
    .from('tasks')
    .update({
      status: 'failed',
      failure_stage: failureStage,
      failure_reason: failureReason,
      refunded,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    throw new AppError(500, '任务状态更新失败。');
  }

  await supabaseAdmin.from('task_events').insert({
    task_id: taskId,
    event_type: 'task_failed',
    detail: { stage: failureStage, reason: failureReason, refunded },
  });
}

export async function completeTask(taskId: string) {
  const { error } = await supabaseAdmin
    .from('tasks')
    .update({
      status: 'completed',
      stage: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    throw new AppError(500, '任务完成状态更新失败。');
  }
}

export async function deleteTask(taskId: string) {
  const { error } = await supabaseAdmin
    .from('tasks')
    .delete()
    .eq('id', taskId);

  if (error) {
    throw new AppError(500, '清理任务失败。');
  }
}
