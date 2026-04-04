import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMaterialContent } from './materialInputService';
import { validateFiles } from './fileService';

test('prepareMaterialContent converts documents to base64 file_data and images to base64 image_url', async () => {
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

  const content = await prepareMaterialContent(files, {
    downloadMaterial: async (storagePath) => {
      if (storagePath.endsWith('.pdf')) {
        return new Blob(['fake pdf body'], { type: 'application/pdf' });
      }
      return new Blob(['fake image body'], { type: 'image/png' });
    },
  });

  assert.equal(content.parts.length, 4);
  assert.deepEqual(content.parts[0], { type: 'input_text', text: '材料文件：report.pdf' });

  // Document should use file_data + filename
  const filePart = content.parts[1] as { type: string; file_data?: string; filename?: string };
  assert.equal(filePart.type, 'input_file');
  assert.equal(typeof filePart.file_data, 'string');
  assert.equal(filePart.filename, 'report.pdf');
  assert.ok(filePart.file_data!.startsWith('data:application/pdf;base64,'));
  const base64Part = filePart.file_data!.split(',')[1];
  assert.equal(Buffer.from(base64Part, 'base64').toString(), 'fake pdf body');

  assert.deepEqual(content.parts[2], { type: 'input_text', text: '材料文件：diagram.png' });

  // Image should use image_url with data URI
  const imagePart = content.parts[3] as { type: string; image_url?: string; detail?: string };
  assert.equal(imagePart.type, 'input_image');
  assert.equal(imagePart.detail, 'auto');
  assert.ok(imagePart.image_url!.startsWith('data:image/png;base64,'));
});

test('prepareMaterialContent propagates download errors', async () => {
  const files = [
    {
      original_name: 'broken.pdf',
      mime_type: 'application/pdf',
      storage_path: 'task/broken.pdf',
    },
  ];

  await assert.rejects(
    () =>
      prepareMaterialContent(files, {
        downloadMaterial: async () => {
          throw new Error('download failed');
        },
      }),
    /download failed/,
  );
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
