import { toFile } from 'openai';
import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { captureError } from '../lib/errorMonitor';

export interface StoredMaterialFile {
  original_name: string;
  mime_type: string | null;
  storage_path: string;
}

export interface MaterialInputTextPart {
  type: 'input_text';
  text: string;
}

export interface MaterialInputFilePart {
  type: 'input_file';
  file_id: string;
}

export interface MaterialInputImagePart {
  type: 'input_image';
  file_id: string;
  detail: 'auto';
}

export type MaterialInputPart =
  | MaterialInputTextPart
  | MaterialInputFilePart
  | MaterialInputImagePart;

interface MaterialPreparationDeps {
  downloadMaterial: (storagePath: string) => Promise<Blob>;
  uploadFile: (body: Blob, filename: string, mimeType: string | null) => Promise<{ id: string }>;
  deleteUploadedFile?: (fileId: string) => Promise<void>;
}

export interface PreparedMaterialContent {
  parts: MaterialInputPart[];
  uploadedFileIds: string[];
}

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'heic', 'heif',
]);

function getFileExtension(filename: string) {
  const segments = filename.toLowerCase().split('.');
  return segments.length > 1 ? segments.pop() || '' : '';
}

function getMimeType(filename: string, mimeType: string | null, body: Blob) {
  if (mimeType) return mimeType;
  if (body.type) return body.type;
  const ext = getFileExtension(filename);
  if (ext === 'jpg') return 'image/jpeg';
  if (ext) return `application/${ext}`;
  return 'application/octet-stream';
}

function isImageFile(filename: string, mimeType: string | null) {
  if (mimeType?.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(getFileExtension(filename));
}

export async function prepareMaterialContent(
  files: StoredMaterialFile[],
  deps: MaterialPreparationDeps,
): Promise<PreparedMaterialContent> {
  const parts: MaterialInputPart[] = [];
  const uploadedFileIds: string[] = [];

  try {
    for (const file of files) {
      const body = await deps.downloadMaterial(file.storage_path);
      const mimeType = getMimeType(file.original_name, file.mime_type, body);
      const uploaded = await deps.uploadFile(body, file.original_name, mimeType);
      uploadedFileIds.push(uploaded.id);

      parts.push({
        type: 'input_text',
        text: `材料文件：${file.original_name}`,
      });

      if (isImageFile(file.original_name, mimeType)) {
        parts.push({
          type: 'input_image',
          file_id: uploaded.id,
          detail: 'auto',
        });
        continue;
      }

      parts.push({
        type: 'input_file',
        file_id: uploaded.id,
      });
    }

    return { parts, uploadedFileIds };
  } catch (error) {
    if (deps.deleteUploadedFile && uploadedFileIds.length > 0) {
      await Promise.allSettled(uploadedFileIds.map((fileId) => deps.deleteUploadedFile!(fileId)));
    }
    throw error;
  }
}

async function downloadMaterialFromStorage(storagePath: string) {
  const { data, error } = await supabaseAdmin.storage
    .from('task-files')
    .download(storagePath);

  if (error || !data) {
    throw new AppError(500, '读取材料文件失败，请稍后重试。');
  }

  return data;
}

async function uploadFileToOpenAI(body: Blob, filename: string, mimeType: string | null) {
  const file = await toFile(body, filename, mimeType ? { type: mimeType } : undefined);
  return openai.files.create({
    file,
    purpose: 'user_data',
  });
}

export async function buildMaterialContentFromStorage(files: StoredMaterialFile[]) {
  return prepareMaterialContent(files, {
    downloadMaterial: downloadMaterialFromStorage,
    uploadFile: uploadFileToOpenAI,
    deleteUploadedFile: async (fileId) => {
      await openai.files.del(fileId);
    },
  });
}

export async function cleanupOpenAIFiles(fileIds: string[]) {
  await Promise.allSettled(
    fileIds.map(async (fileId) => {
      await openai.files.del(fileId);
    }),
  );
}

/**
 * Get material content for a task, reusing cached OpenAI file IDs when available.
 * If files have already been uploaded to OpenAI (openai_file_id is set in DB),
 * builds parts from cached IDs without re-uploading.
 * Otherwise uploads to OpenAI and persists the file IDs for future reuse.
 */
export async function getOrUploadMaterialContent(taskId: string): Promise<PreparedMaterialContent> {
  const { data: files, error } = await supabaseAdmin
    .from('task_files')
    .select('id, original_name, storage_path, mime_type, openai_file_id')
    .eq('task_id', taskId)
    .eq('category', 'material');

  if (error || !files || files.length === 0) {
    throw new AppError(400, '没有找到任务材料文件。');
  }

  const allCached = files.every((f) => typeof f.openai_file_id === 'string' && f.openai_file_id.length > 0);

  if (allCached) {
    // Try to reuse cached file IDs — if any are stale, fall back to re-upload
    try {
      return buildPartsFromCachedIds(files as Array<{
        id: string;
        original_name: string;
        mime_type: string | null;
        openai_file_id: string;
      }>);
    } catch {
      // Stale file IDs — clear them and re-upload below
      await supabaseAdmin
        .from('task_files')
        .update({ openai_file_id: null })
        .eq('task_id', taskId)
        .eq('category', 'material');
    }
  }

  // Upload files that don't have a cached openai_file_id
  const parts: MaterialInputPart[] = [];
  const uploadedFileIds: string[] = [];
  // Track DB row IDs for files we newly uploaded (not previously cached)
  const newlyUploadedDbIds: string[] = [];

  try {
    for (const file of files) {
      let fileId = typeof file.openai_file_id === 'string' && file.openai_file_id.length > 0
        ? file.openai_file_id
        : null;

      if (!fileId) {
        const body = await downloadMaterialFromStorage(file.storage_path);
        const mimeType = getMimeType(file.original_name, file.mime_type, body);
        const uploaded = await uploadFileToOpenAI(body, file.original_name, mimeType);
        fileId = uploaded.id;

        // Persist the openai_file_id to DB for future reuse
        await supabaseAdmin
          .from('task_files')
          .update({ openai_file_id: fileId })
          .eq('id', file.id);

        newlyUploadedDbIds.push(file.id);
      }

      uploadedFileIds.push(fileId);

      parts.push({
        type: 'input_text',
        text: `材料文件：${file.original_name}`,
      });

      if (isImageFile(file.original_name, file.mime_type)) {
        parts.push({
          type: 'input_image',
          file_id: fileId,
          detail: 'auto',
        });
      } else {
        parts.push({
          type: 'input_file',
          file_id: fileId,
        });
      }
    }

    return { parts, uploadedFileIds };
  } catch (err) {
    // Cleanup only the files we just uploaded (not previously cached ones)
    const newlyUploadedOpenAIIds = uploadedFileIds.filter(
      (id) => !files.some((f) => f.openai_file_id === id),
    );
    if (newlyUploadedOpenAIIds.length > 0) {
      await Promise.allSettled(newlyUploadedOpenAIIds.map((id) => openai.files.del(id)));
    }
    // Clear the openai_file_id we just wrote to DB, since those OpenAI files are now deleted
    if (newlyUploadedDbIds.length > 0) {
      await supabaseAdmin
        .from('task_files')
        .update({ openai_file_id: null })
        .in('id', newlyUploadedDbIds);
    }
    throw err;
  }
}

function buildPartsFromCachedIds(files: Array<{
  id: string;
  original_name: string;
  mime_type: string | null;
  openai_file_id: string;
}>): PreparedMaterialContent {
  const parts: MaterialInputPart[] = [];
  const uploadedFileIds: string[] = [];

  for (const file of files) {
    uploadedFileIds.push(file.openai_file_id);

    parts.push({
      type: 'input_text',
      text: `材料文件：${file.original_name}`,
    });

    if (isImageFile(file.original_name, file.mime_type)) {
      parts.push({
        type: 'input_image',
        file_id: file.openai_file_id,
        detail: 'auto',
      });
    } else {
      parts.push({
        type: 'input_file',
        file_id: file.openai_file_id,
      });
    }
  }

  return { parts, uploadedFileIds };
}

/**
 * Clean up all OpenAI files associated with a task's material files.
 * Called when a task completes, fails, or is discarded.
 */
export async function cleanupTaskOpenAIFiles(taskId: string) {
  const { data: files } = await supabaseAdmin
    .from('task_files')
    .select('id, openai_file_id')
    .eq('task_id', taskId)
    .eq('category', 'material')
    .not('openai_file_id', 'is', null);

  if (!files || files.length === 0) return;

  // Try to delete each OpenAI file, track which succeeded
  const results = await Promise.allSettled(
    files.map(async (file) => {
      await openai.files.del(file.openai_file_id as string);
      return file.id; // return DB row id on success
    }),
  );

  const succeededDbIds = results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map((r) => r.value);

  const failedFiles = results.filter((r) => r.status === 'rejected');
  for (const failed of failedFiles) {
    captureError((failed as PromiseRejectedResult).reason, 'cleanup.openai_file_delete', { taskId });
  }

  // Only clear openai_file_id for files that were successfully deleted
  if (succeededDbIds.length > 0) {
    await supabaseAdmin
      .from('task_files')
      .update({ openai_file_id: null })
      .in('id', succeededDbIds);
  }
}
