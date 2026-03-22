import test from 'node:test';
import assert from 'node:assert/strict';
import { discardPendingTaskWithDeps } from './taskService';

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

