import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';
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
export const DOCX_EXTENSIONS = new Set(['docx']);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// 统一白名单：revisionService 在建单前用它做前置校验，避免坏文件混进后台流程
export const SUPPORTED_REVISION_EXTENSIONS = new Set<string>([
  PDF_EXTENSION,
  ...Object.keys(IMAGE_EXTENSIONS),
  ...TEXT_EXTENSIONS,
  ...DOCX_EXTENSIONS,
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
 * 支持的格式：
 *  - PDF                       → document + base64 (application/pdf)
 *  - PNG/JPG/WEBP/GIF 图片     → image + base64
 *  - TXT/MD                    → document + text source
 *  - DOCX                      → 服务端 mammoth 抽文本 → document + text source
 *
 * 关于 docx 为什么必须服务端抽文本（而不是直接传二进制）：
 *  1. api.anthropic.com /v1/messages 的 inline document block 原生只接受 application/pdf。
 *     Anthropic 官方文档原话："For file types that are not supported as document blocks
 *     (.csv, .txt, .md, .docx, .xlsx), convert the files to plain text, and include the
 *     content directly in your message"。docx 二进制塞 base64 上去 Anthropic 自己 400。
 *  2. Files API (file_id) 这条路被 sub2api 网关屏蔽——gateway 只代理 /v1/messages，
 *     根本没有暴露 /v1/files 端点。
 *  3. claude.ai 网页能上传 docx 是因为它走的是 Skills (anthropic-skills:docx) +
 *     Code Execution Tool，需要 workspace API key + 启用 code_execution 工具。而我们
 *     用的是 Pro OAuth token，sub2api gateway 还会强制把 tools 字段清空，这条路
 *     在三层都被堵死。
 *  所以唯一可行就是在我们这边解出文本再以 text source 上送（这正是 Anthropic 文档
 *  推荐的做法）。.doc (老 Word 二进制格式) 仍然不支持，需要用户另存为 docx 或 PDF。
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

    // Word .docx —— 服务端用 mammoth 抽纯文本，以 text document 透传
    // 为什么不能直接传 docx 二进制？见文件顶部注释。
    if (ext === 'docx' || file.mime_type === DOCX_MIME) {
      const { value: text, messages: warnings } = await mammoth.extractRawText({ buffer });
      if (!text.trim()) {
        throw new AppError(400, `Word 文档 ${file.original_name} 内容为空或无法解析。`);
      }
      if (warnings.length) {
        console.warn(
          `[revision-material] mammoth warnings for ${file.original_name}:`,
          warnings.slice(0, 5).map((w) => w.message),
        );
      }
      blocks.push({
        type: 'document',
        source: { type: 'text', media_type: 'text/plain', data: text } as any,
        title: file.original_name,
      } as any);
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

    // 其他格式一律拒绝（含 .doc 老 Word 二进制 / rtf / odt）
    throw new AppError(
      400,
      `不支持的文件类型：${file.original_name}。当前支持 PDF、DOCX、PNG/JPG/WEBP/GIF 图片、TXT/MD 纯文本。如果是 .doc（老 Word 格式），请另存为 .docx 或 PDF。`,
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
