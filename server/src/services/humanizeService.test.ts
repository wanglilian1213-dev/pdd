import test from 'node:test';
import assert from 'node:assert/strict';
import { executeHumanize } from './humanizeService';

test('executeHumanize uses Undetectable output and stores humanized doc on success', async () => {
  const storedFiles: Array<{ category: string; originalName: string; body: Buffer }> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const taskUpdates: Array<Record<string, unknown>> = [];
  const documentVersions: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const settled: number[] = [];

  await assert.doesNotReject(async () => {
    await executeHumanize(
      'task-1',
      'user-1',
      'job-1',
      'Original text content that is long enough to be processed safely.',
      1200,
      250,
      {
        humanizeText: async () => ({
          documentId: 'remote-1',
          output: 'Humanized final text',
        }),
        condensePaper: async (text) => text,
        formatCheckPaper: async (text) => text,
        getTargetWords: async () => 2000,
        insertDocumentVersion: async (payload) => {
          documentVersions.push(payload);
        },
        getConfigValue: async (key) => {
          if (key === 'result_file_retention_days') return 3;
          return null;
        },
        storeGeneratedTaskFile: async (payload) => {
          storedFiles.push({
            category: payload.category,
            originalName: payload.originalName,
            body: payload.body,
          });
        },
        settleCredits: async (_userId, credits) => {
          settled.push(credits);
        },
        refundCredits: async () => {
          throw new Error('refund should not happen');
        },
        updateHumanizeJob: async (_jobId, payload) => {
          jobUpdates.push(payload);
        },
        updateTask: async (_taskId, payload) => {
          taskUpdates.push(payload);
        },
        loadTaskMeta: async () => ({
          title: 'Humanized Energy Essay',
          course_code: 'BUSI1001',
        }),
        insertTaskEvent: async (payload) => {
          events.push(payload);
        },
        now: () => new Date('2026-03-18T06:00:00.000Z'),
      },
    );
  });

  assert.equal(documentVersions.length, 1);
  assert.equal(storedFiles.length, 1);
  assert.equal(storedFiles[0]?.category, 'humanized_doc');
  assert.equal(storedFiles[0]?.originalName, 'humanized-paper.docx');
  assert.deepEqual(settled, [250]);
  assert.equal(jobUpdates.some((payload) => payload.status === 'completed'), true);
  assert.equal(taskUpdates.some((payload) => payload.stage === 'completed'), true);
  assert.equal(events.some((payload) => payload.event_type === 'humanize_completed'), true);
});

test('executeHumanize refunds credits and marks failure when Undetectable call fails', async () => {
  const refunds: number[] = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const taskUpdates: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];

  await executeHumanize(
    'task-2',
    'user-2',
    'job-2',
    'Original text content that is long enough to be processed safely.',
    1200,
    300,
    {
      humanizeText: async () => {
        throw new Error('Undetectable 处理超时');
      },
      condensePaper: async (text) => text,
      formatCheckPaper: async (text) => text,
      getTargetWords: async () => 2000,
      insertDocumentVersion: async () => {
        throw new Error('should not insert document version on failure');
      },
      getConfigValue: async () => 3,
      storeGeneratedTaskFile: async () => {
        throw new Error('should not store file on failure');
      },
      settleCredits: async () => {
        throw new Error('should not settle on failure');
      },
      refundCredits: async (_userId, credits) => {
        refunds.push(credits);
      },
      updateHumanizeJob: async (_jobId, payload) => {
        jobUpdates.push(payload);
      },
      updateTask: async (_taskId, payload) => {
        taskUpdates.push(payload);
      },
      loadTaskMeta: async () => ({
        title: 'Humanized Energy Essay',
        course_code: 'BUSI1001',
      }),
      insertTaskEvent: async (payload) => {
        events.push(payload);
      },
      now: () => new Date('2026-03-18T06:10:00.000Z'),
    },
  );

  assert.deepEqual(refunds, [300]);
  assert.equal(jobUpdates.some((payload) => payload.status === 'failed'), true);
  assert.equal(taskUpdates.some((payload) => payload.stage === 'completed'), true);
  assert.equal(events.some((payload) => payload.event_type === 'humanize_failed'), true);
});
