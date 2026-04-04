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
  file_data: string;
  filename: string;
}

export interface MaterialInputImagePart {
  type: 'input_image';
  image_url: string;
  detail: 'auto';
}

export type MaterialInputPart =
  | MaterialInputTextPart
  | MaterialInputFilePart
  | MaterialInputImagePart;

export interface PreparedMaterialContent {
  parts: MaterialInputPart[];
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

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = Buffer.from(await blob.arrayBuffer());
  return buffer.toString('base64');
}

interface MaterialPreparationDeps {
  downloadMaterial: (storagePath: string) => Promise<Blob>;
}

export async function prepareMaterialContent(
  files: StoredMaterialFile[],
  deps: MaterialPreparationDeps,
): Promise<PreparedMaterialContent> {
  const parts: MaterialInputPart[] = [];

  for (const file of files) {
    const body = await deps.downloadMaterial(file.storage_path);
    const mimeType = getMimeType(file.original_name, file.mime_type, body);
    const base64 = await blobToBase64(body);

    parts.push({
      type: 'input_text',
      text: `材料文件：${file.original_name}`,
    });

    if (isImageFile(file.original_name, mimeType)) {
      parts.push({
        type: 'input_image',
        image_url: `data:${mimeType};base64,${base64}`,
        detail: 'auto',
      });
      continue;
    }

    parts.push({
      type: 'input_file',
      file_data: base64,
      filename: file.original_name,
    });
  }

  return { parts };
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

/**
 * Get material content for a task by downloading from Supabase Storage
 * and converting to base64 inline content for the OpenAI Responses API.
 */
export async function getMaterialContent(taskId: string): Promise<PreparedMaterialContent> {
  const { data: files, error } = await supabaseAdmin
    .from('task_files')
    .select('id, original_name, storage_path, mime_type')
    .eq('task_id', taskId)
    .eq('category', 'material');

  if (error || !files || files.length === 0) {
    throw new AppError(400, '没有找到任务材料文件。');
  }

  return prepareMaterialContent(files, {
    downloadMaterial: downloadMaterialFromStorage,
  });
}

// Keep old name as alias during migration so callers don't break
export const getOrUploadMaterialContent = getMaterialContent;
