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
  extractDocx: (buffer: Buffer) => Promise<{ value: string; messages?: Array<{ message?: string }> }>;
}

const defaultDeps: RevisionMaterialDeps = {
  downloadFile: downloadFromStorage,
  extractDocx: (buffer) => mammoth.extractRawText({ buffer }),
};

export type RevisionInputTextPart = { type: 'input_text'; text: string };
export type RevisionInputFilePart = { type: 'input_file'; filename: string; file_data: string };
export type RevisionInputPart = RevisionInputTextPart | RevisionInputFilePart;

function fileMarker(filename: string): RevisionInputTextPart {
  return { type: 'input_text', text: `材料文件：${filename}` };
}

function textMaterial(filename: string, text: string): RevisionInputTextPart {
  return {
    type: 'input_text',
    text: `【${filename} 内容开始】\n${text}\n【${filename} 内容结束】`,
  };
}

export function collectRevisionMaterialFilenames(parts: ReadonlyArray<RevisionInputPart>): string[] {
  const names: string[] = [];
  for (const part of parts) {
    if (part.type !== 'input_text') continue;
    const match = /^材料文件：(.+)$/.exec(part.text.trim());
    if (match) names.push(match[1]);
  }
  return names;
}

/**
 * 把用户上传的材料文件转换为 OpenAI Responses API 可接受的 input parts。
 *
 * - PDF 用 input_file + data URL
 * - 图片只传文件名说明：当前 sub2api 的 ChatGPT OAuth 通道实测不接受 input_image，会 502
 * - TXT/MD/DOCX 转成 input_text
 * - 每个文件前都加一条"材料文件：xxx"标记，供 prompt 里的主文章/参考材料分组使用
 */
export async function prepareRevisionMaterialForOpenAI(
  files: StoredRevisionFile[],
  deps: RevisionMaterialDeps = defaultDeps,
): Promise<RevisionInputPart[]> {
  const parts: RevisionInputPart[] = [];

  for (const file of files) {
    const ext = getFileExtension(file.original_name);
    const body = await deps.downloadFile(file.storage_path);
    const buffer = Buffer.from(await body.arrayBuffer());
    parts.push(fileMarker(file.original_name));

    if (ext === 'pdf' || file.mime_type === 'application/pdf') {
      parts.push({
        type: 'input_file',
        filename: file.original_name,
        file_data: `data:application/pdf;base64,${buffer.toString('base64')}`,
      });
      continue;
    }

    if (ext === 'docx' || file.mime_type === DOCX_MIME) {
      const { value: text, messages: warnings = [] } = await deps.extractDocx(buffer);
      if (!text.trim()) {
        throw new AppError(400, `Word 文档 ${file.original_name} 内容为空或无法解析。`);
      }
      if (warnings.length) {
        console.warn(
          `[revision-material] mammoth warnings for ${file.original_name}:`,
          warnings.slice(0, 5).map((w) => w.message).filter(Boolean),
        );
      }
      parts.push(textMaterial(file.original_name, text));
      continue;
    }

    if (ext in IMAGE_EXTENSIONS) {
      parts.push(textMaterial(
        file.original_name,
        '这是用户上传的图片文件。当前网关不能稳定读取图片二进制内容；如用户要求处理图片，请基于文件名、用户文字说明和上下文处理，不要声称已看清图片细节。',
      ));
      continue;
    }

    if (TEXT_EXTENSIONS.has(ext) || (file.mime_type?.startsWith('text/') ?? false)) {
      const text = buffer.toString('utf8');
      if (!text.trim()) {
        throw new AppError(400, `文件 ${file.original_name} 内容为空。`);
      }
      parts.push(textMaterial(file.original_name, text));
      continue;
    }

    // 其他格式一律拒绝（含 .doc 老 Word 二进制 / rtf / odt）
    throw new AppError(
      400,
      `不支持的文件类型：${file.original_name}。当前支持 PDF、DOCX、PNG/JPG/WEBP/GIF 图片、TXT/MD 纯文本。如果是 .doc（老 Word 格式），请另存为 .docx 或 PDF。`,
    );
  }

  return parts;
}

export async function getRevisionMaterialContent(
  revisionId: string,
  deps: RevisionMaterialDeps = defaultDeps,
): Promise<RevisionInputPart[]> {
  const { data: files, error } = await supabaseAdmin
    .from('revision_files')
    .select('original_name, storage_path, mime_type')
    .eq('revision_id', revisionId)
    .eq('category', 'material');

  if (error || !files || files.length === 0) {
    throw new AppError(400, '没有找到修改材料文件。');
  }

  return prepareRevisionMaterialForOpenAI(files, deps);
}
