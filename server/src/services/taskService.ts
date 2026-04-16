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
  // 查询 1：写作链路中的任务（status='processing'，唯一索引保证最多一个）
  const { data: activeTask } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .maybeSingle();

  if (activeTask) {
    return getTask(activeTask.id, userId);
  }

  // 查询 2：降 AI 进行中（stage='humanizing' + 双重校验 humanize_jobs.status='processing'）
  // 双重校验防陈年残留：万一 stage 因异常没改回，避免把死任务当当前任务
  const { data: humanizingTask } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .eq('stage', 'humanizing')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (humanizingTask) {
    const { data: activeJob } = await supabaseAdmin
      .from('humanize_jobs')
      .select('id')
      .eq('task_id', humanizingTask.id)
      .eq('status', 'processing')
      .maybeSingle();

    if (activeJob) {
      return getTask(humanizingTask.id, userId);
    }
    // stage='humanizing' 但 job 已死（陈年残留）→ fallthrough 到查询 3
  }

  // 查询 3：用户最近未确认的已结束 humanize（completed/failed + acknowledged=false）
  // 2 步查询保持项目惯例：先拿用户的 task_ids，再在 humanize_jobs 中找最新未确认的
  const { data: userTasks } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'completed');

  if (!userTasks || userTasks.length === 0) {
    return null;
  }

  const userTaskIds = userTasks.map((t) => t.id);

  const { data: pendingAck } = await supabaseAdmin
    .from('humanize_jobs')
    .select('task_id')
    .in('task_id', userTaskIds)
    .in('status', ['completed', 'failed'])
    .eq('acknowledged', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingAck) {
    return getTask(pendingAck.task_id, userId);
  }

  return null;
}

/**
 * 用户主动 dismiss 一个降 AI 任务（点"完成并创建新任务"）
 * 把该 task 下所有 humanize_jobs 的 acknowledged 置为 true
 * 用户多次重试时会留多条记录，一次性 ack 所有避免漏掉旧的
 */
export async function acknowledgeHumanize(taskId: string, userId: string) {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('id', taskId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!task) {
    throw new AppError(404, '任务不存在。');
  }

  const { error } = await supabaseAdmin
    .from('humanize_jobs')
    .update({ acknowledged: true })
    .eq('task_id', taskId);

  if (error) {
    throw new AppError(500, '确认失败，请稍后重试。');
  }
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

export async function failTask(taskId: string, failureStage: string, failureReason: string, refunded: boolean, technicalDetail?: string) {
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
    detail: {
      stage: failureStage,
      reason: failureReason,
      refunded,
      ...(technicalDetail ? { technical_detail: technicalDetail } : {}),
    },
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
