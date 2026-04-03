import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDraftGenerationSystemPrompt,
  buildWordCalibrationSystemPrompt,
  buildCitationVerificationSystemPrompt,
  buildFinalDocDescriptor,
  buildWritingFailureReason,
  storeGeneratedTaskFile,
  writingServiceTestUtils,
} from './writingService';
import * as writingService from './writingService';

test('buildDraftGenerationSystemPrompt includes the stronger first-draft writing rules', () => {
  const prompt = buildDraftGenerationSystemPrompt(2500, 'APA 7', 15);

  assert.match(prompt, /Write the entire article at once/i);
  assert.match(prompt, /Write all chapters/i);
  assert.match(prompt, /Write in paragraphs, no bullet point/i);
  assert.match(prompt, /critical argumentative discussion/i);
  assert.match(prompt, /Always provide specific detailed evidence/i);
  assert.match(prompt, /write in third person/i);
  assert.match(prompt, /Do not Use straight quotation marks/i);
  assert.match(prompt, /Do not use em dash/i);
  assert.match(prompt, /each references should come with proper link/i);
  assert.match(prompt, /Do not use Markdown syntax/i);
  assert.match(prompt, /at least 15 references/i);
  assert.match(prompt, /2020 onwards/i);
  assert.match(prompt, /academic scholar paper/i);
  assert.match(prompt, /not book/i);
});

test('buildWordCalibrationSystemPrompt also forbids markdown-style output', () => {
  const prompt = buildWordCalibrationSystemPrompt(1200, 1500, 'APA 7', 10);

  assert.match(prompt, /Output only the revised paper/i);
  assert.match(prompt, /Do not use Markdown syntax/i);
  assert.match(prompt, /at least 10 references/i);
  assert.match(prompt, /2020 onwards/i);
});

test('buildWordCalibrationSystemPrompt enforces a strict main-body-only word range', () => {
  const prompt = buildWordCalibrationSystemPrompt(1200, 1000, 'APA 7', 5);

  assert.match(prompt, /main body word count/i);
  assert.match(prompt, /title and references do not count/i);
  assert.match(prompt, /900/i);
  assert.match(prompt, /1100/i);
  assert.match(prompt, /very strict rule, must follow/i);
});

test('buildCitationVerificationSystemPrompt also forbids markdown-style output', () => {
  const prompt = buildCitationVerificationSystemPrompt('APA 7', 10);

  assert.match(prompt, /Output the corrected paper text only/i);
  assert.match(prompt, /Do not use Markdown syntax/i);
  assert.match(prompt, /at least 10 references/i);
  assert.match(prompt, /2020 onwards/i);
});

test('storeGeneratedTaskFile throws when storage upload fails', async () => {
  await assert.rejects(
    () =>
      storeGeneratedTaskFile({
        taskId: 'task-1',
        category: 'final_doc',
        originalName: 'final-paper.docx',
        storagePath: 'task-1/final-paper.docx',
        fileSize: 10,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        expiresAtIso: new Date('2026-03-20T00:00:00.000Z').toISOString(),
        body: Buffer.from('file'),
      }, {
        uploadToStorage: async () => ({ error: new Error('upload failed') }),
        insertTaskFileRecord: async () => ({ error: null }),
        removeFromStorage: async () => {},
      }),
    /upload failed/,
  );
});

test('storeGeneratedTaskFile removes uploaded file if database insert fails', async () => {
  const removed: string[] = [];

  await assert.rejects(
    () =>
      storeGeneratedTaskFile({
        taskId: 'task-1',
        category: 'citation_report',
        originalName: 'citation-report.pdf',
        storagePath: 'task-1/citation-report.pdf',
        fileSize: 20,
        mimeType: 'application/pdf',
        expiresAtIso: new Date('2026-03-20T00:00:00.000Z').toISOString(),
        body: Buffer.from('report'),
      }, {
        uploadToStorage: async () => ({ error: null }),
        insertTaskFileRecord: async () => ({ error: new Error('insert failed') }),
        removeFromStorage: async (storagePath) => {
          removed.push(storagePath);
        },
      }),
    /insert failed/,
  );

  assert.deepEqual(removed, ['task-1/citation-report.pdf']);
});

test('buildFinalDocDescriptor keeps the readable download name but uses a safe storage path', () => {
  const descriptor = buildFinalDocDescriptor(
    'task-1',
    'The Impact of Social Media Use on University Students’ Mental Health',
  );

  assert.equal(
    descriptor.originalName,
    'The Impact of Social Media Use on University Students’ Mental Health.docx',
  );
  assert.equal(descriptor.storagePath, 'task-1/final-paper.docx');
});

test('buildWritingFailureReason tells the user when draft generation timed out', () => {
  const error = new Error('draft_generation timed out after 600000ms');
  error.name = 'WritingStageTimeoutError';

  assert.equal(
    buildWritingFailureReason('writing', error),
    '初稿生成超时，积分已自动退回。请稍后重试。',
  );
});

test('buildWritingFailureReason keeps the deliver-stage wording specific', () => {
  assert.equal(
    buildWritingFailureReason('delivering', new Error('storage failed')),
    '文件交付过程中出现问题，积分已自动退回。请重新创建任务。',
  );
});

test('drafts that refuse to answer are treated as repairable instead of deliverable', () => {
  const assess = (writingService as Record<string, unknown>).assessGeneratedPaper as ((text: string) => {
    valid: boolean;
    shouldRepair: boolean;
    reasons: string[];
  }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    'Please provide the topic or exact research question. A full argumentative article cannot be written responsibly without it.',
  );

  assert.equal(result.valid, false);
  assert.equal(result.shouldRepair, true);
  assert.ok(result.reasons.some((reason) => /refusal/i.test(reason)));
});

test('drafts without in-text citations or references are treated as repairable instead of deliverable', () => {
  const assess = (writingService as Record<string, unknown>).assessGeneratedPaper as ((text: string) => {
    valid: boolean;
    shouldRepair: boolean;
    reasons: string[];
  }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    'Artificial intelligence is reshaping managerial writing in small businesses. The argument remains descriptive and never cites any source.\n\nConclusion\nThe article ends here.',
  );

  assert.equal(result.valid, false);
  assert.equal(result.shouldRepair, true);
  assert.ok(result.reasons.some((reason) => /citation/i.test(reason)));
  assert.ok(result.reasons.some((reason) => /references/i.test(reason)));
});

test('drafts with citations and a references section are treated as deliverable', () => {
  const assess = (writingService as Record<string, unknown>).assessGeneratedPaper as ((text: string) => {
    valid: boolean;
    shouldRepair: boolean;
    reasons: string[];
  }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    'Artificial intelligence can improve strategic writing quality when managers use it as a drafting aid rather than a substitute for judgement (Smith, 2024).\n\nReferences\nSmith, J. (2024). Strategic writing and AI. https://example.com/article',
  );

  assert.equal(result.valid, true);
  assert.equal(result.shouldRepair, false);
  assert.deepEqual(result.reasons, []);
});

test('drafts with too few references for the required count are treated as repairable', () => {
  const assess = (writingService as Record<string, unknown>).assessGeneratedPaper as ((text: string, options?: {
    requiredReferenceCount?: number;
    citationStyle?: string;
  }) => {
    valid: boolean;
    shouldRepair: boolean;
    reasons: string[];
  }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    'Argument text with citations (Smith, 2024) and (Jones, 2023).\n\nReferences\nSmith, J. (2024). Journal article title. Journal of Academic Writing, 10(2), 1-10. https://doi.org/10.1000/test1\n\nJones, A. (2023). Another article title. Studies in Education, 8(1), 11-20. https://doi.org/10.1000/test2',
    { requiredReferenceCount: 5, citationStyle: 'APA 7' },
  );

  assert.equal(result.valid, false);
  assert.equal(result.shouldRepair, true);
  assert.ok(result.reasons.some((reason) => /reference count/i.test(reason)));
});

test('drafts with pre-2020 references or obvious books are treated as repairable', () => {
  const assess = (writingService as Record<string, unknown>).assessGeneratedPaper as ((text: string, options?: {
    requiredReferenceCount?: number;
    citationStyle?: string;
  }) => {
    valid: boolean;
    shouldRepair: boolean;
    reasons: string[];
  }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    'Argument text with citations (Smith, 2018) and (Brown, 2024).\n\nReferences\nSmith, J. (2018). Old article. Journal of Writing Studies, 10(2), 1-10. https://doi.org/10.1000/test1\n\nBrown, T. (2024). Handbook of Academic Writing. Oxford University Press.',
    { requiredReferenceCount: 2, citationStyle: 'APA 7' },
  );

  assert.equal(result.valid, false);
  assert.equal(result.shouldRepair, true);
  assert.ok(result.reasons.some((reason) => /2020/i.test(reason)));
  assert.ok(result.reasons.some((reason) => /academic/i.test(reason) || /book/i.test(reason)));
});

test('withRewriteStageTimeout returns the original result when the stage finishes in time', async () => {
  const result = await writingServiceTestUtils.withRewriteStageTimeout(
    'citation_verification',
    Promise.resolve('ok'),
    20,
  );

  assert.equal(result, 'ok');
});

test('withRewriteStageTimeout raises a timeout error when the stage takes too long', async () => {
  await assert.rejects(
    () =>
      writingServiceTestUtils.withRewriteStageTimeout(
        'citation_verification',
        new Promise<string>(() => {}),
        5,
      ),
    (error: unknown) => {
      assert.equal(writingServiceTestUtils.isWritingStageTimeoutError(error), true);
      return true;
    },
  );
});

test('draft generation also has a timeout guard instead of hanging forever', async () => {
  assert.equal(typeof (writingServiceTestUtils as Record<string, unknown>).withDraftGenerationTimeout, 'function');

  const withDraftGenerationTimeout = (writingServiceTestUtils as Record<string, unknown>).withDraftGenerationTimeout as
    | ((operation: Promise<string>, timeoutMs?: number) => Promise<string>)
    | undefined;

  await assert.rejects(
    () => withDraftGenerationTimeout!(new Promise<string>(() => {}), 5),
    (error: unknown) => {
      assert.equal(writingServiceTestUtils.isWritingStageTimeoutError(error), true);
      return true;
    },
  );
});

test('default writing timeout settings match the configured long-running limits', () => {
  const getStageTimeoutMs = (writingServiceTestUtils as Record<string, unknown>).getStageTimeoutMs as
    | ((stage: 'draft_generation' | 'word_calibration' | 'citation_verification') => number)
    | undefined;

  assert.equal(typeof getStageTimeoutMs, 'function');
  assert.equal(getStageTimeoutMs!('draft_generation'), 1_800_000);
  assert.equal(getStageTimeoutMs!('word_calibration'), 900_000);
  assert.equal(getStageTimeoutMs!('citation_verification'), 1_200_000);
});

test('countMainBodyWords ignores the title and references section', () => {
  const countMainBodyWords = (writingServiceTestUtils as Record<string, unknown>).countMainBodyWords as
    | ((text: string) => number)
    | undefined;

  assert.equal(typeof countMainBodyWords, 'function');

  const text = [
    'Essay Title',
    '',
    'This paragraph totals exactly six words.',
    '',
    'References',
    'Smith, J. (2024). Example article. https://example.com',
  ].join('\n');

  assert.equal(countMainBodyWords!(text), 6);
});

test('runWordCalibrationAttempts retries up to five times and stops once the body word count is in range', async () => {
  const runWordCalibrationAttempts = (writingServiceTestUtils as Record<string, unknown>).runWordCalibrationAttempts as
    | ((options: {
        initialText: string;
        targetWords: number;
        maxAttempts?: number;
        rewrite: (text: string, attempt: number) => Promise<string>;
      }) => Promise<{ text: string; attemptsUsed: number; withinRange: boolean }>)
    | undefined;

  assert.equal(typeof runWordCalibrationAttempts, 'function');

  const attempts: number[] = [];
  const result = await runWordCalibrationAttempts!({
    initialText: 'Title\n\n' + 'word '.repeat(1400) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com',
    targetWords: 1000,
    rewrite: async (_text, attempt) => {
      attempts.push(attempt);
      if (attempt < 3) {
        return 'Title\n\n' + 'word '.repeat(1300) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com';
      }
      return 'Title\n\n' + 'word '.repeat(1000) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com';
    },
  });

  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(result.attemptsUsed, 3);
  assert.equal(result.withinRange, true);
});

test('runWordCalibrationAttempts returns the fifth rewrite even when body word count still misses the strict range', async () => {
  const runWordCalibrationAttempts = (writingServiceTestUtils as Record<string, unknown>).runWordCalibrationAttempts as
    | ((options: {
        initialText: string;
        targetWords: number;
        maxAttempts?: number;
        rewrite: (text: string, attempt: number) => Promise<string>;
      }) => Promise<{ text: string; attemptsUsed: number; withinRange: boolean }>)
    | undefined;

  assert.equal(typeof runWordCalibrationAttempts, 'function');

  const attempts: number[] = [];
  const result = await runWordCalibrationAttempts!({
    initialText: 'Title\n\n' + 'word '.repeat(1600) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com',
    targetWords: 1000,
    rewrite: async (_text, attempt) => {
      attempts.push(attempt);
      return 'Title\n\n' + 'word '.repeat(1300) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com';
    },
  });

  assert.deepEqual(attempts, [1, 2, 3, 4, 5]);
  assert.equal(result.attemptsUsed, 5);
  assert.equal(result.withinRange, false);
});
