import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDraftGenerationSystemPrompt,
  buildWordCalibrationSystemPrompt,
  buildCitationVerificationSystemPrompt,
  storeGeneratedTaskFile,
} from './writingService';

test('buildDraftGenerationSystemPrompt includes the stronger first-draft writing rules', () => {
  const prompt = buildDraftGenerationSystemPrompt(2500, 'APA 7');

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
});

test('buildWordCalibrationSystemPrompt also forbids markdown-style output', () => {
  const prompt = buildWordCalibrationSystemPrompt(1200, 1500);

  assert.match(prompt, /Output only the revised paper/i);
  assert.match(prompt, /Do not use Markdown syntax/i);
});

test('buildCitationVerificationSystemPrompt also forbids markdown-style output', () => {
  const prompt = buildCitationVerificationSystemPrompt('APA 7');

  assert.match(prompt, /Output the corrected paper text only/i);
  assert.match(prompt, /Do not use Markdown syntax/i);
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
