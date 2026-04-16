import mammoth from 'mammoth';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';

// pdf-parse 没有官方 d.ts；延迟 require 避免默认入口在 node 启动时触发 test 资源加载。
// 走 /lib/pdf-parse.js 绕过顶层入口那段 "if (module === require.main)" 的测试分支。
// 同时放在运行时 require，单元测试里用 DI 注入 mock 的 parsePdf 时根本不触发真实依赖。
let cachedPdfParse: ((buffer: Buffer) => Promise<{ text: string; numpages: number }>) | null =
  null;

function loadPdfParse() {
  if (cachedPdfParse) return cachedPdfParse;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  cachedPdfParse = require('pdf-parse/lib/pdf-parse.js');
  return cachedPdfParse!;
}

// ----- 类型 -----------------------------------------------------------------

/**
 * 后端按文件名关键词预判的角色。最终以 GPT 在 detected_files 里的裁决为准。
 */
export type HintedRole = 'article' | 'rubric' | 'brief' | 'unknown';

/**
 * GPT 读完内容后最终裁决的角色。
 */
export type DetectedRole = 'article' | 'rubric' | 'brief' | 'other';

export interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  mimetype?: string;
}

export interface ExtractedFileInfo {
  filename: string;
  wordCount: number;
  hintedRole: HintedRole;
  isImage: boolean;
  isScannedPdf: boolean;
  rawText: string | null;
  mimeType: string;
}

export interface ScoringMaterialDeps {
  parsePdf: (buffer: Buffer) => Promise<{ text: string }>;
  extractDocx: (buffer: Buffer) => Promise<{ value: string }>;
  downloadFile: (storagePath: string) => Promise<Blob>;
}

// ----- 常量 -----------------------------------------------------------------

const CJK_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown']);
const DOCX_EXTENSIONS = new Set(['docx']);
const PDF_EXTENSION = 'pdf';

export const SUPPORTED_SCORING_EXTENSIONS = new Set<string>([
  PDF_EXTENSION,
  ...IMAGE_EXTENSIONS,
  ...TEXT_EXTENSIONS,
  ...DOCX_EXTENSIONS,
]);

// 文件名关键词（小写匹配）。中英都覆盖一些常见写法。
const RUBRIC_KEYWORDS = [
  'rubric',
  'criteria',
  'marking',
  'grading',
  'assessment criteria',
  '评分',
  '评分标准',
  '评分表',
  '评审标准',
];

const BRIEF_KEYWORDS = [
  'brief',
  'assignment',
  'task',
  'instructions',
  'instruction',
  'guide',
  'writing guide',
  'information',
  '题目',
  '任务',
  '任务要求',
  '作业',
  '要求',
  '指导',
  '说明',
];

const ARTICLE_KEYWORDS = [
  'essay',
  'report',
  'paper',
  'draft',
  'final',
  'article',
  'manuscript',
  'submission',
  '文章',
  '论文',
  '稿',
];

// ----- 工具函数 -------------------------------------------------------------

/**
 * 计算字数：东亚字符（汉/假名/朝文）每字 1 word，其余西文按空白切词。
 * 不引入中文分词依赖。
 */
export function countWords(text: string): number {
  if (!text) return 0;

  const cjkMatches = text.match(CJK_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // 把 CJK 字符全部替换成空格，再按空白切剩下的西文 token
  const withoutCjk = text.replace(CJK_REGEX, ' ');
  const trimmed = withoutCjk.trim();
  if (!trimmed) return cjkCount;

  const westernTokens = trimmed.split(/\s+/).filter(Boolean);
  return cjkCount + westernTokens.length;
}

export function getFileExtension(filename: string): string {
  const segments = filename.toLowerCase().split('.');
  return segments.length > 1 ? segments.pop() || '' : '';
}

/**
 * 按文件名关键词预判角色。最终以 GPT 的 detected_files 为准。
 */
export function hintFileRole(filename: string): HintedRole {
  const lower = filename.toLowerCase();

  if (RUBRIC_KEYWORDS.some((kw) => lower.includes(kw))) return 'rubric';
  if (BRIEF_KEYWORDS.some((kw) => lower.includes(kw))) return 'brief';
  if (ARTICLE_KEYWORDS.some((kw) => lower.includes(kw))) return 'article';
  return 'unknown';
}

/**
 * 判断 PDF 提取的文字是不是"一大堆私用区字符 / 替换字符"。
 * 加密字体 / 老字体的 PDF 提取出来是乱码，但 text.length > 0，
 * 用这个兜底判成扫描件让前置拒绝生效。
 */
export function isMostlyGarbage(text: string): boolean {
  if (text.length < 20) return false;
  let garbage = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (ch === '\uFFFD' || (code >= 0xe000 && code <= 0xf8ff)) {
      garbage += 1;
    }
  }
  return garbage / text.length >= 0.9;
}

// ----- 提取 -----------------------------------------------------------------

async function defaultParsePdf(buffer: Buffer) {
  return loadPdfParse()(buffer);
}

async function defaultExtractDocx(buffer: Buffer) {
  return mammoth.extractRawText({ buffer });
}

async function defaultDownloadFile(storagePath: string): Promise<Blob> {
  const { data, error } = await supabaseAdmin.storage
    .from('task-files')
    .download(storagePath);
  if (error || !data) {
    throw new AppError(500, '读取评审材料文件失败，请稍后重试。');
  }
  return data;
}

export const defaultScoringMaterialDeps: ScoringMaterialDeps = {
  parsePdf: defaultParsePdf,
  extractDocx: defaultExtractDocx,
  downloadFile: defaultDownloadFile,
};

/**
 * 从单个上传文件提取文字和字数。
 * - 扫描件 PDF 返回 { isScannedPdf: true, wordCount: 0 }，由上层决定是否拒绝
 * - 图片返回 { isImage: true, wordCount: 0 }
 * - 不支持的扩展名直接抛 400
 */
export async function extractFileText(
  file: UploadedFileLike,
  deps: ScoringMaterialDeps = defaultScoringMaterialDeps,
): Promise<ExtractedFileInfo> {
  const ext = getFileExtension(file.originalname);
  const hintedRole = hintFileRole(file.originalname);
  const mimeType = file.mimetype || '';

  // TXT / MD
  if (TEXT_EXTENSIONS.has(ext)) {
    const text = file.buffer.toString('utf8');
    return {
      filename: file.originalname,
      wordCount: countWords(text),
      hintedRole,
      isImage: false,
      isScannedPdf: false,
      rawText: text,
      mimeType,
    };
  }

  // DOCX
  if (DOCX_EXTENSIONS.has(ext)) {
    const { value: text } = await deps.extractDocx(file.buffer);
    if (!text || !text.trim()) {
      throw new AppError(400, `Word 文档 ${file.originalname} 内容为空或无法解析。`);
    }
    return {
      filename: file.originalname,
      wordCount: countWords(text),
      hintedRole,
      isImage: false,
      isScannedPdf: false,
      rawText: text,
      mimeType,
    };
  }

  // PDF
  if (ext === PDF_EXTENSION) {
    // pdf-parse 偶尔会卡很久（特别是扫描件 / 嵌图 / 老格式 PDF）。
    // 加 30 秒硬 timeout：超时按"扫描件 / 加密"处理，前置拒绝该文件。
    const PDF_PARSE_TIMEOUT_MS = 30_000;
    let parseResult: { text: string };
    try {
      parseResult = await Promise.race([
        deps.parsePdf(file.buffer),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new AppError(
                  400,
                  `PDF ${file.originalname} 解析超时（可能是扫描件或加密文件），请换一份文字版 PDF 或 DOCX。`,
                ),
              ),
            PDF_PARSE_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // pdf-parse 自己也可能抛错（比如 PDF 头损坏）→ 一律按扫描件 / 不可解析处理
      return {
        filename: file.originalname,
        wordCount: 0,
        hintedRole,
        isImage: false,
        isScannedPdf: true,
        rawText: null,
        mimeType,
      };
    }
    const { text } = parseResult;
    const trimmed = (text || '').trim();
    if (trimmed.length === 0 || isMostlyGarbage(trimmed)) {
      return {
        filename: file.originalname,
        wordCount: 0,
        hintedRole,
        isImage: false,
        isScannedPdf: true,
        rawText: null,
        mimeType,
      };
    }
    return {
      filename: file.originalname,
      wordCount: countWords(trimmed),
      hintedRole,
      isImage: false,
      isScannedPdf: false,
      rawText: trimmed,
      mimeType,
    };
  }

  // 图片
  if (IMAGE_EXTENSIONS.has(ext)) {
    return {
      filename: file.originalname,
      wordCount: 0,
      hintedRole,
      isImage: true,
      isScannedPdf: false,
      rawText: null,
      mimeType,
    };
  }

  throw new AppError(
    400,
    `不支持的文件类型：${file.originalname}。当前支持 PDF（文字版）、DOCX、PNG/JPG/WEBP/GIF 图片、TXT/MD 纯文本。`,
  );
}

/**
 * 批量提取上传文件并做前置校验：
 * - 任一 PDF 是扫描件 → 400「扫描件暂不支持评审」
 * - 全部文件都是图片 → 400「请至少上传一个可提取文字的文件」
 */
export async function validateAndExtractScoringInputs(
  files: UploadedFileLike[],
  deps: ScoringMaterialDeps = defaultScoringMaterialDeps,
): Promise<ExtractedFileInfo[]> {
  if (!files || files.length === 0) {
    throw new AppError(400, '请至少上传一个文件。');
  }

  const results: ExtractedFileInfo[] = [];
  for (const file of files) {
    results.push(await extractFileText(file, deps));
  }

  const scanned = results.find((r) => r.isScannedPdf);
  if (scanned) {
    throw new AppError(
      400,
      `扫描件暂不支持评审：${scanned.filename}。请上传文字版 PDF 或 DOCX。`,
    );
  }

  const hasAnyText = results.some((r) => !r.isImage && r.wordCount > 0);
  if (!hasAnyText) {
    throw new AppError(400, '请至少上传一个可提取文字的文件（PDF 文字版 / DOCX / TXT）。');
  }

  return results;
}

// ----- 材料 → OpenAI parts --------------------------------------------------

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

export type ScoringInputPart =
  | MaterialInputTextPart
  | MaterialInputFilePart
  | MaterialInputImagePart;

export interface StoredScoringFile {
  original_name: string;
  storage_path: string;
  mime_type: string | null;
  hinted_role: HintedRole | null;
}

function getMimeType(filename: string, mimeType: string | null, body: Blob) {
  if (mimeType) return mimeType;
  if (body.type) return body.type;
  const ext = getFileExtension(filename);
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (TEXT_EXTENSIONS.has(ext)) return 'text/plain';
  return 'application/octet-stream';
}

/**
 * 把已经上传到 Storage 的评审材料打包成 OpenAI Responses API 的 content parts。
 * 每个文件前加一行 input_text：「材料文件：<name>（预判角色：<hintedRole>）」
 * - DOCX：服务端 mammoth 抽纯文本 → input_text
 * - PDF：input_file (base64) 透传
 * - 图片：input_image (base64)
 * - TXT/MD：input_text
 */
export async function prepareScoringMaterialForOpenAI(
  scoringId: string,
  deps: ScoringMaterialDeps = defaultScoringMaterialDeps,
): Promise<ScoringInputPart[]> {
  const { data: files, error } = await supabaseAdmin
    .from('scoring_files')
    .select('original_name, storage_path, mime_type, hinted_role')
    .eq('scoring_id', scoringId)
    .eq('category', 'material');

  if (error || !files || files.length === 0) {
    throw new AppError(400, '没有找到评审材料文件。');
  }

  return prepareScoringMaterialParts(files as StoredScoringFile[], deps);
}

export async function prepareScoringMaterialParts(
  files: StoredScoringFile[],
  deps: ScoringMaterialDeps = defaultScoringMaterialDeps,
): Promise<ScoringInputPart[]> {
  const parts: ScoringInputPart[] = [];

  for (const file of files) {
    const body = await deps.downloadFile(file.storage_path);
    const buffer = Buffer.from(await body.arrayBuffer());
    const mimeType = getMimeType(file.original_name, file.mime_type, body);
    const ext = getFileExtension(file.original_name);
    const hintedRole = file.hinted_role || 'unknown';

    parts.push({
      type: 'input_text',
      text: `材料文件：${file.original_name}（预判角色：${hintedRole}）`,
    });

    if (DOCX_EXTENSIONS.has(ext)) {
      const { value: text } = await deps.extractDocx(buffer);
      parts.push({
        type: 'input_text',
        text:
          text && text.trim()
            ? `<<<BEGIN DOCX CONTENT OF ${file.original_name}>>>\n${text}\n<<<END DOCX CONTENT>>>`
            : `[DOCX ${file.original_name} 提取失败，可按文件名预判处理]`,
      });
      continue;
    }

    if (TEXT_EXTENSIONS.has(ext)) {
      parts.push({
        type: 'input_text',
        text: `<<<BEGIN TEXT CONTENT OF ${file.original_name}>>>\n${buffer.toString('utf8')}\n<<<END TEXT CONTENT>>>`,
      });
      continue;
    }

    const base64 = buffer.toString('base64');

    if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) {
      parts.push({
        type: 'input_image',
        image_url: `data:${mimeType};base64,${base64}`,
        detail: 'auto',
      });
      continue;
    }

    if (ext === PDF_EXTENSION || mimeType === 'application/pdf') {
      parts.push({
        type: 'input_file',
        file_data: `data:${mimeType};base64,${base64}`,
        filename: file.original_name,
      });
      continue;
    }

    // 理论上已在 extractFileText 阶段挡掉，这里兜底跳过而不是崩掉
    parts.push({
      type: 'input_text',
      text: `[未知格式文件：${file.original_name}，跳过原文]`,
    });
  }

  return parts;
}

// ----- 结算字数对齐 --------------------------------------------------------

/**
 * 把 GPT 回写的 filename 归一化：trim + toLowerCase + 去掉 / 和 \ 前缀。
 * 用于结算阶段对齐上传的 original_name 和 GPT 返回的 detected_files[].filename。
 */
export function normalizeFilename(name: string): string {
  if (!name) return '';
  const trimmed = name.trim().toLowerCase();
  const segments = trimmed.split(/[/\\]/);
  return segments[segments.length - 1] || '';
}
