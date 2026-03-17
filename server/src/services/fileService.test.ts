import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadFilesWithDeps } from './fileService';

test('uploadFilesWithDeps cleans up uploaded files and inserted records if a later database insert fails', async () => {
  const removedStoragePaths: string[] = [];
  const removedRecordIds: string[] = [];

  const files = [
    {
      originalname: 'first.pdf',
      buffer: Buffer.from('first'),
      size: 5,
      mimetype: 'application/pdf',
    },
    {
      originalname: 'second.pdf',
      buffer: Buffer.from('second'),
      size: 6,
      mimetype: 'application/pdf',
    },
  ] as Express.Multer.File[];

  await assert.rejects(
    () =>
      uploadFilesWithDeps('task-1', files, {
        uploadToStorage: async (storagePath) => {
          return { storagePath };
        },
        insertTaskFileRecord: async (file) => {
          if (file.original_name === 'second.pdf') {
            throw new Error('insert failed');
          }
          return { id: `record-${file.original_name}` };
        },
        removeFromStorage: async (storagePath) => {
          removedStoragePaths.push(storagePath);
        },
        removeTaskFileRecord: async (recordId) => {
          removedRecordIds.push(recordId);
        },
        now: () => 1000,
      }),
    /insert failed/,
  );

  assert.deepEqual(removedStoragePaths, [
    'task-1/1000-first.pdf',
    'task-1/1000-second.pdf',
  ]);
  assert.deepEqual(removedRecordIds, ['record-first.pdf']);
});
