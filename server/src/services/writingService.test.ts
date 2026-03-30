import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDraftGenerationSystemPrompt,
  buildWordCalibrationSystemPrompt,
  buildCitationVerificationSystemPrompt,
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
