import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMaterialContent } from './materialInputService';
import { validateFiles } from './fileService';

test('prepareMaterialContent uploads both documents and images, and uses file_id inputs', async () => {
  const files = [
    {
      original_name: 'report.pdf',
      mime_type: 'application/pdf',
      storage_path: 'task/report.pdf',
    },
    {
      original_name: 'diagram.png',
      mime_type: 'image/png',
      storage_path: 'task/diagram.png',
    },
  ];

  const uploaded: Array<{ filename: string; mimeType: string | null; body: Blob }> = [];
  const deleted: string[] = [];
  const content = await prepareMaterialContent(files, {
    downloadMaterial: async (storagePath) => {
      if (storagePath.endsWith('.pdf')) {
        return new Blob(['fake pdf body'], { type: 'application/pdf' });
      }
      return new Blob(['fake image body'], { type: 'image/png' });
    },
    uploadFile: async (body, filename, mimeType) => {
      uploaded.push({ body, filename, mimeType });
      return { id: `file_${filename}` };
    },
    deleteUploadedFile: async (fileId) => {
      deleted.push(fileId);
    },
  });

  assert.equal(uploaded.length, 2);
  assert.equal(uploaded[0]?.filename, 'report.pdf');
  assert.equal(uploaded[0]?.mimeType, 'application/pdf');
  assert.equal(uploaded[1]?.filename, 'diagram.png');
  assert.equal(uploaded[1]?.mimeType, 'image/png');
  assert.equal(content.uploadedFileIds.length, 2);
  assert.deepEqual(content.uploadedFileIds, ['file_report.pdf', 'file_diagram.png']);
  assert.deepEqual(content.parts[0], { type: 'input_text', text: '材料文件：report.pdf' });
  assert.deepEqual(content.parts[1], { type: 'input_file', file_id: 'file_report.pdf' });
  assert.deepEqual(content.parts[2], { type: 'input_text', text: '材料文件：diagram.png' });
  assert.equal(content.parts[3]?.type, 'input_image');
  assert.equal(content.parts[3]?.detail, 'auto');
  assert.equal(content.parts[3]?.file_id, 'file_diagram.png');
  assert.deepEqual(deleted, []);
});

test('prepareMaterialContent cleans up already uploaded files if a later file fails', async () => {
  const files = [
    {
      original_name: 'ok.pdf',
      mime_type: 'application/pdf',
      storage_path: 'task/ok.pdf',
    },
    {
      original_name: 'broken.pdf',
      mime_type: 'application/pdf',
      storage_path: 'task/broken.pdf',
    },
  ];

  const deleted: string[] = [];

  await assert.rejects(
    () =>
      prepareMaterialContent(files, {
        downloadMaterial: async (storagePath) => {
          if (storagePath.endsWith('broken.pdf')) {
            throw new Error('download failed');
          }
          return new Blob(['good'], { type: 'application/pdf' });
        },
        uploadFile: async (_body, filename) => ({ id: `file_${filename}` }),
        deleteUploadedFile: async (fileId) => {
          deleted.push(fileId);
        },
      }),
    /download failed/,
  );

  assert.deepEqual(deleted, ['file_ok.pdf']);
});

test('validateFiles allows unknown extensions when size limits are respected', () => {
  const files = [
    {
      originalname: 'archive.custom-bin',
      size: 1024,
    },
  ] as Express.Multer.File[];

  assert.doesNotThrow(() => validateFiles(files));
});

test('validateFiles still blocks oversized files', () => {
  const files = [
    {
      originalname: 'too-large.anything',
      size: 21 * 1024 * 1024,
    },
  ] as Express.Multer.File[];

  assert.throws(() => validateFiles(files), /超过 20MB/);
});
