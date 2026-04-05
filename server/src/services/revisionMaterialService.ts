import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';

interface StoredRevisionFile {
  original_name: string;
  mime_type: string | null;
  storage_path: string;
}

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'heic', 'heif',
]);

function getFileExtension(filename: string): string {
  const segments = filename.toLowerCase().split('.');
  return segments.length > 1 ? segments.pop() || '' : '';
}

function isImageFile(filename: string, mimeType: string | null): boolean {
  if (mimeType?.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(getFileExtension(filename));
}

function getMimeType(filename: string, mimeType: string | null, body: Blob): string {
  if (mimeType) return mimeType;
  if (body.type) return body.type;
  const ext = getFileExtension(filename);
  if (ext === 'jpg') return 'image/jpeg';
  if (ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'doc') return 'application/msword';
  return 'application/octet-stream';
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = Buffer.from(await blob.arrayBuffer());
  return buffer.toString('base64');
}

async function downloadFromStorage(storagePath: string): Promise<Blob> {
  const { data, error } = await supabaseAdmin.storage
    .from('task-files')
    .download(storagePath);

  if (error || !data) {
    throw new AppError(500, '读取材料文件失败，请稍后重试。');
  }

  return data;
}

export interface RevisionMaterialDeps {
  downloadFile: (storagePath: string) => Promise<Blob>;
}

const defaultDeps: RevisionMaterialDeps = {
  downloadFile: downloadFromStorage,
};

export async function prepareRevisionMaterialForClaude(
  files: StoredRevisionFile[],
  deps: RevisionMaterialDeps = defaultDeps,
): Promise<Anthropic.ContentBlockParam[]> {
  const blocks: Anthropic.ContentBlockParam[] = [];

  for (const file of files) {
    const body = await deps.downloadFile(file.storage_path);
    const mimeType = getMimeType(file.original_name, file.mime_type, body);
    const base64 = await blobToBase64(body);

    if (isImageFile(file.original_name, mimeType)) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: base64,
        },
      });
    } else {
      blocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: mimeType as any,
          data: base64,
        },
      });
    }
  }

  return blocks;
}

export async function getRevisionMaterialContent(
  revisionId: string,
  deps: RevisionMaterialDeps = defaultDeps,
): Promise<Anthropic.ContentBlockParam[]> {
  const { data: files, error } = await supabaseAdmin
    .from('revision_files')
    .select('original_name, storage_path, mime_type')
    .eq('revision_id', revisionId)
    .eq('category', 'material');

  if (error || !files || files.length === 0) {
    throw new AppError(400, '没有找到修改材料文件。');
  }

  return prepareRevisionMaterialForClaude(files, deps);
}
