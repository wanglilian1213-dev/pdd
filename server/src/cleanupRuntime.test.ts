import test from 'node:test';
import assert from 'node:assert/strict';
import { runInitialCleanup } from './cleanupRuntime';

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
