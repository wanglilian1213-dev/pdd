import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';

interface StoredRevisionFile {
  original_name: string;
  mime_type: string | null;
  storage_path: string;
}

export const IMAGE_EXTENSIONS: Record<string, 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
export const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown']);
export const PDF_EXTENSION = 'pdf';

// 统一白名单：revisionService 在建单前用它做前置校验，避免坏文件混进后台流程
export const SUPPORTED_REVISION_EXTENSIONS = new Set<string>([
  PDF_EXTENSION,
  ...Object.keys(IMAGE_EXTENSIONS),
  ...TEXT_EXTENSIONS,
]);

export function getFileExtension(filename: string): string {
  const segments = filename.toLowerCase().split('.');
  return segments.length > 1 ? segments.pop() || '' : '';
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

/**
 * 把用户上传的材料文件转换为 Anthropic Messages API 的 ContentBlock 数组。
 *
 * 设计原则：**零本地预处理**。文件原封不动地以 base64/raw text 形式上送给上游 API，
 * 不做任何文本抽取、格式转换、markdown 化。
 *
 * 支持的格式：
 *  - PDF                       → document + base64 (application/pdf)
 *  - PNG/JPG/WEBP/GIF 图片     → image + base64
 *  - TXT/MD                    → document + text source（透传 raw text）
 *
 * 不支持的格式（含 doc/docx/rtf/odt）会在这里直接抛 400，由前端引导用户先导出为 PDF。
 * 原因：`api.anthropic.com/v1/messages` 的 inline document block 只接受 application/pdf，
 * 其他二进制格式会被上游拒绝。
 */
export async function prepareRevisionMaterialForClaude(
  files: StoredRevisionFile[],
  deps: RevisionMaterialDeps = defaultDeps,
): Promise<Anthropic.ContentBlockParam[]> {
  const blocks: Anthropic.ContentBlockParam[] = [];

  for (const file of files) {
    const ext = getFileExtension(file.original_name);
    const body = await deps.downloadFile(file.storage_path);
    const buffer = Buffer.from(await body.arrayBuffer());

    // PDF —— 唯一支持的文档格式
    if (ext === 'pdf' || file.mime_type === 'application/pdf') {
      blocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: buffer.toString('base64'),
        },
      });
      continue;
    }

    // 图片
    if (ext in IMAGE_EXTENSIONS) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: IMAGE_EXTENSIONS[ext],
          data: buffer.toString('base64'),
        },
      });
      continue;
    }

    // 纯文本
    if (TEXT_EXTENSIONS.has(ext) || (file.mime_type?.startsWith('text/') ?? false)) {
      const text = buffer.toString('utf8');
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

    // 其他格式（含 doc/docx/rtf/odt）一律拒绝
    throw new AppError(
      400,
      `不支持的文件类型：${file.original_name}。当前仅支持 PDF、PNG/JPG/WEBP/GIF 图片、TXT/MD 纯文本。请将 Word 文档导出为 PDF 后再上传。`,
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
