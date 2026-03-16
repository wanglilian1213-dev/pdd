import { supabaseAdmin } from '../lib/supabase';
import { AppError, ActiveTaskExistsError } from '../lib/errors';

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
    files: files.data || [],
    outlines: outlines.data || [],
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

export async function getTaskList(userId: string, status?: string, limit = 20, offset = 0) {
  let query = supabaseAdmin
    .from('tasks')
    .select('id, title, stage, status, target_words, frozen_credits, failure_stage, failure_reason, refunded, created_at, completed_at, updated_at', { count: 'exact' })
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
