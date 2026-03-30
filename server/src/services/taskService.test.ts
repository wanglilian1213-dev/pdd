import test from 'node:test';
import assert from 'node:assert/strict';
import { supabaseAdmin } from '../lib/supabase';
import { ActiveTaskExistsError } from '../lib/errors';
import { createTask, discardPendingTaskWithDeps } from './taskService';

function stubSupabaseFrom(impl: (table: string) => any) {
  const originalFrom = supabaseAdmin.from;

  Object.defineProperty(supabaseAdmin, 'from', {
    value: impl,
    configurable: true,
  });

  return () => {
    Object.defineProperty(supabaseAdmin, 'from', {
      value: originalFrom,
      configurable: true,
    });
  };
}

test('discardPendingTaskWithDeps deletes outline-ready task files from storage before removing the task', async () => {
  const removedPaths: string[] = [];
  let deletedTaskId: string | null = null;

  await discardPendingTaskWithDeps('task-1', 'user-1', {
    loadTask: async () => ({
      id: 'task-1',
      user_id: 'user-1',
      stage: 'outline_ready',
      status: 'processing',
      frozen_credits: 0,
    }),
    listTaskFiles: async () => ([
      { storage_path: 'task-1/material-1.pdf' },
      { storage_path: 'task-1/material-2.pdf' },
    ]),
    removeStoragePaths: async (paths) => {
      removedPaths.push(...paths);
    },
    deleteTask: async (taskId) => {
      deletedTaskId = taskId;
    },
  });

  assert.deepEqual(removedPaths, [
    'task-1/material-1.pdf',
    'task-1/material-2.pdf',
  ]);
  assert.equal(deletedTaskId, 'task-1');
});

test('createTask turns database unique conflicts into ActiveTaskExistsError', async () => {
  const restore = stubSupabaseFrom((table: string) => {
    if (table !== 'tasks') {
      throw new Error(`unexpected table ${table}`);
    }

    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: null }),
          }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: { code: '23505' },
          }),
        }),
      }),
    };
  });

  try {
    await assert.rejects(
      () => createTask('user-1', '任务标题', '要求'),
      (error: unknown) => error instanceof ActiveTaskExistsError,
    );
  } finally {
    restore();
  }
});
