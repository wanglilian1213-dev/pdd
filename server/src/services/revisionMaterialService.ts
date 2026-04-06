import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';
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
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'rtf']);
const WORD_EXTENSIONS = new Set(['doc', 'docx']);

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
    const ext = getFileExtension(file.original_name);

    // 1) 图片 → image block
    if (isImageFile(file.original_name, mimeType)) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: await blobToBase64(body),
        },
      });
      continue;
    }

    // 2) PDF → document base64（Claude inline 仅支持 application/pdf）
    if (ext === 'pdf' || mimeType === 'application/pdf') {
      blocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: await blobToBase64(body),
        },
      });
      continue;
    }

    // 3) Word → 用 mammoth 提取纯文本（Claude 不接受 docx 内联，pddapi.cc 也不代理 Files API）
    if (WORD_EXTENSIONS.has(ext)) {
      const buffer = Buffer.from(await body.arrayBuffer());
      let text = '';
      try {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value || '';
      } catch (err) {
        throw new AppError(400, `无法解析 Word 文件 ${file.original_name}，请尝试转为 PDF 后上传。`);
      }
      if (!text.trim()) {
        throw new AppError(400, `Word 文件 ${file.original_name} 内容为空。`);
      }
      blocks.push({
        type: 'document',
        source: { type: 'text', media_type: 'text/plain', data: text } as any,
        title: file.original_name,
      } as any);
      continue;
    }

    // 4) 纯文本（txt/md/rtf 等）→ document + text source
    if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith('text/')) {
      const text = await body.text();
      if (!text.trim()) {
        throw new AppError(400, `文件 ${file.original_name} 内容为空。`);
      }
      blocks.push({
        type: 'document',
        source: { type: 'text', media_type: 'text/plain', data: text } as any,
        title: file.original_name,
      } as any);
      continue;
    }

    // 5) 其他不支持的格式明确拒绝
    throw new AppError(
      400,
      `不支持的文件类型：${file.original_name}。请上传 PDF、Word(.doc/.docx)、纯文本或图片。`,
    );
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
