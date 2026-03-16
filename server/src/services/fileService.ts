import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE, MAX_TOTAL_SIZE, MAX_FILES_PER_TASK } from '../types';
import path from 'path';

export function validateFiles(files: Express.Multer.File[]) {
  if (files.length === 0) {
    throw new AppError(400, '请至少上传一个文件。');
  }
  if (files.length > MAX_FILES_PER_TASK) {
    throw new AppError(400, `最多上传 ${MAX_FILES_PER_TASK} 个文件。`);
  }

  let totalSize = 0;
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (!ALLOWED_FILE_TYPES.includes(ext)) {
      throw new AppError(400, `不支持的文件格式：${ext}。支持的格式：${ALLOWED_FILE_TYPES.join(', ')}。`);
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new AppError(400, `文件 ${file.originalname} 超过 20MB 大小限制。`);
    }
    totalSize += file.size;
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    throw new AppError(400, '文件总大小超过 50MB 限制。');
  }
}

export async function uploadFiles(taskId: string, files: Express.Multer.File[]) {
  const records = [];

  for (const file of files) {
    const storagePath = `${taskId}/${Date.now()}-${file.originalname}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('task-files')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      throw new AppError(500, `文件 ${file.originalname} 上传失败，请稍后重试。`);
    }

    const { error: dbError } = await supabaseAdmin
      .from('task_files')
      .insert({
        task_id: taskId,
        category: 'material',
        original_name: file.originalname,
        storage_path: storagePath,
        file_size: file.size,
        mime_type: file.mimetype,
      });

    if (dbError) {
      throw new AppError(500, `文件记录保存失败。`);
    }

    records.push({ name: file.originalname, size: file.size });
  }

  return records;
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
