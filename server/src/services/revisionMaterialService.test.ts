import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectRevisionMaterialFilenames,
  prepareRevisionMaterialForOpenAI,
  type RevisionMaterialDeps,
} from './revisionMaterialService';

function blob(content: string | Buffer, type = 'application/octet-stream') {
  return new Blob([content], { type });
}

function makeDeps(files: Record<string, Blob>, overrides: Partial<RevisionMaterialDeps> = {}): RevisionMaterialDeps {
  return {
    downloadFile: async (storagePath: string) => {
      const file = files[storagePath];
      if (!file) throw new Error(`missing fixture: ${storagePath}`);
      return file;
    },
    extractDocx: async () => ({ value: 'Docx body from mock extractor.' }),
    ...overrides,
  };
}

test('prepareRevisionMaterialForOpenAI sends PDF as file and images as safe text notes with filenames', async () => {
  const parts = await prepareRevisionMaterialForOpenAI(
    [
      { original_name: 'paper.pdf', mime_type: 'application/pdf', storage_path: 'paper' },
      { original_name: 'chart.png', mime_type: 'image/png', storage_path: 'chart' },
    ],
    makeDeps({
      paper: blob('%PDF-1.4', 'application/pdf'),
      chart: blob(Buffer.from([1, 2, 3]), 'image/png'),
    }),
  );

  assert.deepEqual(collectRevisionMaterialFilenames(parts), ['paper.pdf', 'chart.png']);
  assert.equal(parts[0].type, 'input_text');
  assert.match(parts[0].text, /材料文件：paper\.pdf/);
  assert.equal(parts[1].type, 'input_file');
  assert.equal(parts[1].filename, 'paper.pdf');
  assert.match(parts[1].file_data, /^data:application\/pdf;base64,/);
  assert.equal(parts[2].type, 'input_text');
  assert.match(parts[2].text, /材料文件：chart\.png/);
  assert.equal(parts[3].type, 'input_text');
  assert.match(parts[3].text, /图片文件/);
});

test('prepareRevisionMaterialForOpenAI converts txt and docx to input_text parts', async () => {
  const parts = await prepareRevisionMaterialForOpenAI(
    [
      { original_name: 'notes.txt', mime_type: 'text/plain', storage_path: 'notes' },
      { original_name: 'draft.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'draft' },
    ],
    makeDeps({
      notes: blob('Plain text body.', 'text/plain'),
      draft: blob(Buffer.from([4, 5, 6])),
    }),
  );

  assert.deepEqual(collectRevisionMaterialFilenames(parts), ['notes.txt', 'draft.docx']);
  const text = parts
    .filter((part) => part.type === 'input_text')
    .map((part) => part.text)
    .join('\n');
  assert.match(text, /Plain text body\./);
  assert.match(text, /Docx body from mock extractor\./);
});
