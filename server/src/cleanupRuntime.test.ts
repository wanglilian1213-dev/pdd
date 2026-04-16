import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupExpiredMaterialsWithDeps,
  DEFAULT_STUCK_TASK_TIMEOUT_MINUTES,
  isAutoCleanupStage,
  runInitialCleanup,
} from './cleanupRuntime';

test('runInitialCleanup catches startup failures so cleanup service does not crash', async () => {
  const messages: string[] = [];

  await assert.doesNotReject(async () => {
    await runInitialCleanup(
      {
        cleanupStuckTasks: async () => {
          throw new Error('db down');
        },
        cleanupStuckRevisions: async () => {
          throw new Error('should not run after first failure');
        },
        cleanupStuckScorings: async () => {
          throw new Error('should not run after first failure');
        },
        cleanupExpiredFiles: async () => {
          throw new Error('should not run after first failure');
        },
        cleanupExpiredMaterials: async () => {
          throw new Error('should not run after first failure');
        },
        cleanupExpiredScoringMaterials: async () => {
          throw new Error('should not run after first failure');
        },
        cleanupExpiredScoringReports: async () => {
          throw new Error('should not run after first failure');
        },
      },
      {
        log: (message: string) => {
          messages.push(message);
        },
        error: (message: string) => {
          messages.push(message);
        },
      },
    );
  });

  assert.equal(messages.some((message) => message.includes('Running initial cleanup')), true);
  assert.equal(messages.some((message) => message.includes('Initial cleanup failed')), true);
});

test('isAutoCleanupStage excludes outline_ready because it is waiting for the user', () => {
  assert.equal(isAutoCleanupStage('outline_ready'), false);
});

test('isAutoCleanupStage keeps backend-driven stuck stages eligible for cleanup', () => {
  assert.deepEqual(
    [
      'uploading',
      'outline_generating',
      'writing',
      'word_calibrating',
      'citation_checking',
      'delivering',
      'humanizing',
    ].map((stage) => ({
      stage,
      value: isAutoCleanupStage(stage),
    })),
    [
      { stage: 'uploading', value: true },
      { stage: 'outline_generating', value: true },
      { stage: 'writing', value: true },
      { stage: 'word_calibrating', value: true },
      { stage: 'citation_checking', value: true },
      { stage: 'delivering', value: true },
      { stage: 'humanizing', value: true },
    ],
  );
});

test('default stuck task timeout is 45 minutes', () => {
  assert.equal(DEFAULT_STUCK_TASK_TIMEOUT_MINUTES, 45);
});

test('cleanupExpiredMaterials only deletes expired materials for finished tasks', async () => {
  const removedStoragePaths: string[] = [];
  const deletedTaskFileIds: string[] = [];
  const logMessages: string[] = [];

  await cleanupExpiredMaterialsWithDeps({
    getRetentionDays: async () => 3,
    listExpiredMaterials: async () => [
      { id: 'material-completed', taskId: 'task-completed', storagePath: 'materials/completed.pdf' },
      { id: 'material-failed', taskId: 'task-failed', storagePath: 'materials/failed.pdf' },
      { id: 'material-processing', taskId: 'task-processing', storagePath: 'materials/processing.pdf' },
      { id: 'material-outline', taskId: 'task-outline', storagePath: 'materials/outline.pdf' },
    ],
    listTasksByIds: async () => [
      { id: 'task-completed', status: 'completed' },
      { id: 'task-failed', status: 'failed' },
      { id: 'task-processing', status: 'processing' },
      { id: 'task-outline', status: 'processing' },
    ],
    removeStorageFile: async (storagePath: string) => {
      removedStoragePaths.push(storagePath);
    },
    deleteTaskFileRecord: async (fileId: string) => {
      deletedTaskFileIds.push(fileId);
    },
    captureCleanupError: () => {},
    logger: {
      log: (message: string) => {
        logMessages.push(message);
      },
      error: () => {},
    },
  });

  assert.deepEqual(removedStoragePaths, ['materials/completed.pdf', 'materials/failed.pdf']);
  assert.deepEqual(deletedTaskFileIds, ['material-completed', 'material-failed']);
  assert.equal(
    logMessages.some((message) => message.includes('Skipped 2 expired material files because their tasks are not finished')),
    true,
  );
});
