import test from 'node:test';
import assert from 'node:assert/strict';
import { isAutoCleanupStage, runInitialCleanup } from './cleanupRuntime';

test('runInitialCleanup catches startup failures so cleanup service does not crash', async () => {
  const messages: string[] = [];

  await assert.doesNotReject(async () => {
    await runInitialCleanup(
      {
        cleanupStuckTasks: async () => {
          throw new Error('db down');
        },
        cleanupExpiredFiles: async () => {
          throw new Error('should not run after first failure');
        },
        cleanupExpiredMaterials: async () => {
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
