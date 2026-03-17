import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { MAX_FILE_SIZE, MAX_TOTAL_SIZE, MAX_FILES_PER_TASK } from '../types';

interface UploadFilesDeps {
  uploadToStorage: (storagePath: string, file: Express.Multer.File) => Promise<{ storagePath: string }>;
  insertTaskFileRecord: (record: {
    task_id: string;
    category: 'material';
    original_name: string;
    storage_path: string;
    file_size: number;
    mime_type: string;
  }) => Promise<{ id: string }>;
  removeFromStorage: (storagePath: string) => Promise<void>;
  removeTaskFileRecord: (recordId: string) => Promise<void>;
  now?: () => number;
}

export function validateFiles(files: Express.Multer.File[]) {
  if (files.length === 0) {
    throw new AppError(400, '请至少上传一个文件。');
  }
  if (files.length > MAX_FILES_PER_TASK) {
    throw new AppError(400, `最多上传 ${MAX_FILES_PER_TASK} 个文件。`);
  }

  let totalSize = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      throw new AppError(400, `文件 ${file.originalname} 超过 20MB 大小限制。`);
    }
    totalSize += file.size;
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    throw new AppError(400, '文件总大小超过 50MB 限制。');
  }
}

export async function uploadFilesWithDeps(taskId: string, files: Express.Multer.File[], deps: UploadFilesDeps) {
  const uploadedPaths: string[] = [];
  const insertedRecordIds: string[] = [];
  const results = [];
  const getNow = deps.now || Date.now;

  try {
    for (const file of files) {
      const storagePath = `${taskId}/${getNow()}-${file.originalname}`;

      const uploaded = await deps.uploadToStorage(storagePath, file);
      uploadedPaths.push(uploaded.storagePath);

      const inserted = await deps.insertTaskFileRecord({
        task_id: taskId,
        category: 'material',
        original_name: file.originalname,
        storage_path: uploaded.storagePath,
        file_size: file.size,
        mime_type: file.mimetype,
      });

      insertedRecordIds.push(inserted.id);
      results.push({ name: file.originalname, size: file.size });
    }

    return results;
  } catch (error) {
    await Promise.allSettled(insertedRecordIds.map((recordId) => deps.removeTaskFileRecord(recordId)));
    await Promise.allSettled(uploadedPaths.map((storagePath) => deps.removeFromStorage(storagePath)));
    throw error;
  }
}

export async function uploadFiles(taskId: string, files: Express.Multer.File[]) {
  return uploadFilesWithDeps(taskId, files, {
    uploadToStorage: async (storagePath, file) => {
      const { error: uploadError } = await supabaseAdmin.storage
        .from('task-files')
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
        });

      if (uploadError) {
        throw new AppError(500, `文件 ${file.originalname} 上传失败，请稍后重试。`);
      }

      return { storagePath };
    },
    insertTaskFileRecord: async (record) => {
      const { data, error: dbError } = await supabaseAdmin
        .from('task_files')
        .insert(record)
        .select('id')
        .single();

      if (dbError || !data) {
        throw new AppError(500, '文件记录保存失败。');
      }

      return { id: data.id as string };
    },
    removeFromStorage: async (storagePath) => {
      await supabaseAdmin.storage.from('task-files').remove([storagePath]);
    },
    removeTaskFileRecord: async (recordId) => {
      await supabaseAdmin.from('task_files').delete().eq('id', recordId);
    },
  });
}

export async function getDownloadUrl(taskId: string, fileId: string, userId: string) {
  const { data: file } = await supabaseAdmin
    .from('task_files')
    .select('id, task_id, storage_path, original_name, expires_at')
    .eq('id', fileId)
    .eq('task_id', taskId)
    .single();

  if (!file) {
    throw new AppError(404, '文件不存在。');
  }

  // Verify ownership
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('user_id')
    .eq('id', taskId)
    .single();

  if (!task || task.user_id !== userId) {
    throw new AppError(404, '文件不存在。');
  }

  if (file.expires_at && new Date(file.expires_at) < new Date()) {
    throw new AppError(410, '文件已过期，无法下载。');
  }

  const { data, error } = await supabaseAdmin.storage
    .from('task-files')
    .createSignedUrl(file.storage_path, 3600);

  if (error || !data) {
    throw new AppError(500, '生成下载链接失败。');
  }

  return { url: data.signedUrl, filename: file.original_name };
}

export async function deleteExpiredFiles() {
  const { data: expiredFiles } = await supabaseAdmin
    .from('task_files')
    .select('id, storage_path')
    .lt('expires_at', new Date().toISOString());

  if (!expiredFiles || expiredFiles.length === 0) return 0;

  for (const file of expiredFiles) {
    await supabaseAdmin.storage.from('task-files').remove([file.storage_path]);
    await supabaseAdmin.from('task_files').delete().eq('id', file.id);
  }

  return expiredFiles.length;
}
