import test from 'node:test';
import assert from 'node:assert/strict';
import { executeHumanize } from './humanizeService';

test('executeHumanize loops StealthWriter until V2 >= 90 and stores final doc', async () => {
  const storedFiles: Array<{ category: string; originalName: string; body: Buffer }> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const taskUpdates: Array<Record<string, unknown>> = [];
  const documentVersions: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const settled: number[] = [];
  let moreCount = 0;

  await assert.doesNotReject(async () => {
    await executeHumanize(
      'task-1',
      'user-1',
      'job-1',
      'Original text content that is long enough to be processed safely.',
      1200,
      250,
      {
        humanize: async (text) => ({
          originalText: text,
          output: 'Humanized draft 1',
          sentences: [],
          resultId: 'remote-1',
          raw: {},
        }),
        humanizeMore: async (current) => {
          moreCount += 1;
          return {
            originalText: current.originalText,
            output: moreCount === 1 ? 'Humanized draft 2' : 'Humanized final text',
            sentences: [],
            resultId: `remote-${moreCount + 1}`,
            raw: {},
          };
        },
        scanV2: async (text) => ({
          normalScore:
            text === 'Humanized draft 1'
              ? 84
              : text === 'Humanized draft 2'
                ? 88
                : 93,
          verdict: text === 'Humanized final text' ? 'looks_human' : 'ai_detected',
          sentences: [],
          resultId: `scan-${text.replace(/\s+/g, '-').toLowerCase()}`,
          raw: {},
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
  assert.equal(jobUpdates.some((payload) => payload.final_human_score === 93), true);
  assert.equal(jobUpdates.some((payload) => payload.humanize_more_attempts === 2), true);
  assert.equal(
    jobUpdates.some(
      (payload) =>
        (payload.result_json as { human_score?: number; display_text?: string } | undefined)?.human_score === 93
        && (payload.result_json as { display_text?: string } | undefined)?.display_text === 'Humanized final text',
    ),
    true,
  );
  assert.equal(taskUpdates.some((payload) => payload.stage === 'completed'), true);
  assert.equal(events.some((payload) => payload.event_type === 'humanize_completed'), true);
});

test('executeHumanize refunds credits and marks failure when StealthWriter call fails', async () => {
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
      humanize: async () => {
        throw new Error('StealthWriter 会话已失效');
      },
      humanizeMore: async () => {
        throw new Error('should not retry after first failure');
      },
      scanV2: async () => {
        throw new Error('should not scan after humanize failure');
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

test('executeHumanize stores latest sentence scan when StealthWriter cannot reach delivery score', async () => {
  const refunds: number[] = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const taskUpdates: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  let attempt = 0;

  await executeHumanize(
    'task-3',
    'user-3',
    'job-3',
    'Original text content that is long enough to be processed safely.',
    1200,
    300,
    {
      humanize: async () => ({
        originalText: 'Original text content that is long enough to be processed safely.',
        output: 'Humanized draft 0',
        sentences: [],
        resultId: 'remote-0',
        raw: {},
      }),
      humanizeMore: async () => {
        attempt += 1;
        return {
          originalText: 'Original text content that is long enough to be processed safely.',
          output: `Humanized draft ${attempt}`,
          sentences: [],
          resultId: `remote-${attempt}`,
          raw: {},
        };
      },
      scanV2: async () => ({
        normalScore: 41,
        verdict: 'ai_detected',
        sentences: [
          { sentence: 'Still looks AI.', score: 0.41, label: 'ai' },
          { sentence: 'Slightly better.', score: 0.68, label: 'human' },
        ],
        resultId: `scan-${attempt}`,
        raw: {},
      }),
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
      now: () => new Date('2026-03-18T06:20:00.000Z'),
    },
  );

  assert.deepEqual(refunds, [300]);
  assert.equal(
    jobUpdates.some(
      (payload) =>
        payload.status === 'failed'
        && payload.final_human_score === 41
        && payload.humanize_more_attempts === 12
        && (payload.result_json as {
          human_score?: number;
          display_text?: string;
          sentences?: Array<{ label?: string }>;
        } | undefined)
          ?.human_score === 41
        && (payload.result_json as { display_text?: string } | undefined)?.display_text === 'Humanized draft 12'
        && (payload.result_json as { sentences?: Array<{ label?: string }> } | undefined)
          ?.sentences?.[0]?.label === 'ai',
    ),
    true,
  );
  assert.equal(taskUpdates.some((payload) => payload.stage === 'completed'), true);
  assert.equal(events.some((payload) => payload.event_type === 'humanize_failed'), true);
});

test('executeHumanize protects References from StealthWriter rewriting', async () => {
  const inputWithRefs = [
    'This is the introduction paragraph of the academic paper.',
    '',
    'This is the body section discussing key findings.',
    '',
    'References',
    '',
    'Smith, J. (2024). Digital Transformation. Journal of Tech, 45(2), 120-135.',
    'Jones, A. (2023). AI in Education. Academic Review, 12(1), 50-65.',
  ].join('\n');

  let humanizeInput = '';
  let storedContent = '';

  await executeHumanize(
      'task-refs', 'user-refs', 'job-refs',
      inputWithRefs, 100, 250,
    {
      humanize: async (text) => {
        humanizeInput = text;
        return {
          originalText: text,
          output: 'Rewritten body text by StealthWriter.',
          sentences: [],
          resultId: 'remote-refs',
          raw: {},
        };
      },
      humanizeMore: async () => {
        throw new Error('should not need humanize more');
      },
      scanV2: async () => ({
        normalScore: 94,
        verdict: 'looks_human',
        sentences: [],
        resultId: 'scan-refs',
        raw: {},
      }),
      condensePaper: async (text) => text,
      formatCheckPaper: async (text) => text,
      getTargetWords: async () => 2000,
      insertDocumentVersion: async (payload) => { storedContent = payload.content; },
      getConfigValue: async () => 3,
      storeGeneratedTaskFile: async () => {},
      settleCredits: async () => {},
      refundCredits: async () => {},
      updateHumanizeJob: async () => {},
      updateTask: async () => {},
      loadTaskMeta: async () => ({ title: 'Refs Test', course_code: null }),
      insertTaskEvent: async () => {},
      now: () => new Date('2026-04-13T00:00:00.000Z'),
    },
  );

  // humanize should only receive body, not References
  assert.ok(!humanizeInput.includes('References'), 'humanize should NOT receive References heading');
  assert.ok(!humanizeInput.includes('Smith, J.'), 'humanize should NOT receive reference entries');

  // Final stored content must contain original References intact
  assert.ok(storedContent.includes('References'), 'final content must contain References heading');
  assert.ok(storedContent.includes('Smith, J. (2024)'), 'final content must preserve first reference entry');
  assert.ok(storedContent.includes('Jones, A. (2023)'), 'final content must preserve all reference entries');
});
