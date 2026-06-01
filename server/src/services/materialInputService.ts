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
const UNSAFE_FILENAME_TEXT_RE = /\b(?:ignore|disregard)\s+(?:all\s+)?(?:previous|above|system|developer)\s+instructions\b|\bprint\s+(?:the\s+)?(?:api key|secret|system prompt)\b|\b(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|SERVICE_ROLE_KEY|API[_-]?KEY|SECRET|TOKEN|PASSWORD|system prompt|developer prompt)\b|输出.*(?:密钥|系统提示词|后台提示词)|忽略.*(?:规则|指令|要求)/i;
const PRIVATE_FILENAME_TEXT_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[-+]?\d{1,2}\.\d{4,}\s*,\s*[-+]?\d{1,3}\.\d{4,}|\+?\d[\d\s().-]{7,}\d|\b(?:MRN|medical record|patient id|participant id|subject id|SSN|NHS)\s*[:#-]?\s*[A-Z0-9-]{3,}\b|(?:学号|学生号|学生编号|工号|员工号|医院号|门诊号|住院号|病案号|病历号|身份证号?|护照号|医保号|宿舍号|家庭住址|住址)\s*[:：#-]?\s*[A-Z0-9\u4e00-\u9fff-]{2,}|(?:学生|患者|病人|受试者|客户|员工|姓名)\s*[:：#-]?\s*[\u4e00-\u9fff]{2,4}/i;
const CHINESE_PERSON_FILENAME_RE = /(?:^|[\s._\-()（）\[\]【】])(?:欧阳|司马|上官|诸葛|东方|夏侯|张|王|李|赵|陈|刘|杨|黄|周|吴|徐|孙|胡|朱|高|林|何|郭|马|罗|梁|宋|郑|谢|韩|唐|冯|于|董|萧|程|曹|袁|邓|许|傅|沈|曾|彭|吕|苏|卢|蒋|蔡|贾|丁|魏|薛|叶|阎|余|潘|杜|戴|夏|钟|汪|田|任|姜|范|方|石|姚|谭|廖|邹|熊|金|陆|郝|孔|白|崔|康|毛|邱|秦|江|史|顾|侯|邵|孟|龙|万|段|雷|钱|汤|尹|黎|易|常|武|乔|贺|赖|龚|文)[\u4e00-\u9fff]{1,2}(?=$|[\s._\-()（）\[\]【】])/;

function getFileExtension(filename: string) {
  const segments = filename.toLowerCase().split('.');
  return segments.length > 1 ? segments.pop() || '' : '';
}

function normalizeFilenameText(filename: string) {
  return filename
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.trim() || '';
}

function safeMaterialFilename(filename: string) {
  const normalized = normalizeFilenameText(filename);
  const ext = getFileExtension(normalized);
  const safeExt = /^[a-z0-9]{1,10}$/.test(ext) && !UNSAFE_FILENAME_TEXT_RE.test(ext) ? `.${ext}` : '';

  if (!normalized || UNSAFE_FILENAME_TEXT_RE.test(normalized) || PRIVATE_FILENAME_TEXT_RE.test(normalized) || CHINESE_PERSON_FILENAME_RE.test(normalized)) {
    return `redacted-material${safeExt}`;
  }

  return normalized.slice(0, 180);
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
    const filename = safeMaterialFilename(file.original_name);
    const base64 = await blobToBase64(body);

    parts.push({
      type: 'input_text',
      text: `材料文件：${filename}`,
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
      file_data: `data:${mimeType};base64,${base64}`,
      filename,
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
