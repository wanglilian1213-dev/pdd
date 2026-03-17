import { toFile } from 'openai';
import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';

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
