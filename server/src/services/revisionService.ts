import { supabaseAdmin } from '../lib/supabase';
import { anthropic } from '../lib/anthropic';
import { AppError, InsufficientBalanceError } from '../lib/errors';
import { freezeCredits, settleCredits, refundCredits, getBalance } from './walletService';
import { getConfig } from './configService';
import {
  getRevisionMaterialContent,
  SUPPORTED_REVISION_EXTENSIONS,
  getFileExtension,
} from './revisionMaterialService';
import { buildFormattedPaperDocBufferWithMedia } from './documentFormattingService';
import { parseRevisionOutput } from './revisionContentParser';
import { renderCharts, type RenderedChart } from './chartRenderService';
import { isMostlyGarbage } from './scoringMaterialService';
import {
  detectMainArticle,
  type ArticleDetectionFile,
  type ArticleDetectionResult,
} from './articleDetectionService';
import mammoth from 'mammoth';
import { captureError } from '../lib/errorMonitor';

// pdf-parse 没有官方 d.ts；延迟 require 避免默认入口在 node 启动时触发 test 资源加载。
// 走 /lib/pdf-parse.js 绕过顶层入口那段 "if (module === require.main)" 的测试分支。
let cachedPdfParse: ((buffer: Buffer) => Promise<{ text: string; numpages: number }>) | null = null;
function loadPdfParse() {
  if (cachedPdfParse) return cachedPdfParse;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  cachedPdfParse = require('pdf-parse/lib/pdf-parse.js');
  return cachedPdfParse!;
}

// ---------------------------------------------------------------------------
// System prompt：把 Claude 从「乐于助人的聊天助手」拉成「严格的论文修订工」。
// 关键约束：
//  1. 严格遵循指令（不展开详细列「不许做什么」，按用户要求）
//  2. 严格基于上传原文做最小修改
//  3. 输出即最终交付物，不带开场白、不带修改总结、不带代码块
//  4. 图表用 [CHART_BEGIN]…[CHART_END] DSL（server 端会真实渲染为 PNG 嵌入 docx）
//  5. 表格用标准 Markdown 表格（server 端会转成 Word 原生 Table）
// ---------------------------------------------------------------------------
const REVISION_SYSTEM_PROMPT = `你是一名严谨的学术论文修改助手。你的唯一任务是基于用户上传的原始文档，按照用户给出的修改指令，输出修改后的完整论文最终稿。

绝对规则：
1. 严格遵循用户指令。指令要做什么就做什么。
2. 严格基于用户上传的原始文档作为底稿。所有修改建立在原文之上，保留原作者的论证逻辑、术语和文风，做最小必要的修改。
3. 你的输出就是最终交付物。直接输出修改后的完整论文全文，不要任何开场白、不要任何结尾总结、不要任何"以上修改包括"之类的话。

图表生成（chart / graph / 折线图 / 柱状图 / 饼图 / 雷达图 / 散点图等）：
当用户要求添加或修改图表时，必须使用以下专用 DSL 输出。系统会自动把它渲染为真实图片嵌入 Word 文档，不要输出 Python / matplotlib / R / 任何代码：

[CHART_BEGIN]
{
  "title": "图 1：示例标题",
  "width": 720,
  "height": 440,
  "chartjs": {
    "type": "line",
    "data": {
      "labels": ["A", "B", "C"],
      "datasets": [{ "label": "数据", "data": [1, 2, 3] }]
    },
    "options": {
      "plugins": { "title": { "display": true, "text": "示例标题" } },
      "scales": { "y": { "beginAtZero": true } }
    }
  }
}
[CHART_END]

DSL 硬性规则（违反任何一条都会导致图渲染失败）：
- chartjs 字段必须是合法的 Chart.js v3 JSON 配置（type / data / options），不能出现 callbacks、函数字符串、未在下方列出的字段
- chartjs.type 必须是以下之一，其他类型一律禁止：line / bar / pie / doughnut / radar / scatter / bubble / polarArea
- chartjs.data.labels 必须是字符串数组，长度 ≤ 50，每个字符串 ≤ 80 字符
- chartjs.data.datasets 必须是数组，长度 ≤ 5
- 每个 dataset 的 data 字段必须是**纯数字数组**（line/bar/pie/doughnut/radar/polarArea），长度 ≤ 100
  - 例外：scatter / bubble 类型可以用 {x: number, y: number} 或 {x, y, r} 对象
  - 不允许出现字符串数字（"12.5"），不允许出现 null
- 每个 dataset 的 label 字段 ≤ 80 字符
- title 文本 ≤ 80 字符；中文论文用「图 N：xxx」，英文论文用「Figure N: xxx」，按图表出现顺序编号
- options 字段只允许 plugins.title / plugins.legend / scales.{x,y}.beginAtZero，其他 options 字段不要写
- 整个 [CHART_BEGIN]…[CHART_END] 块（含 JSON）大小 ≤ 30KB
- 一个 [CHART_BEGIN]...[CHART_END] 块只放一张图
- 块的前后必须各有一个空行，独立成段，不要嵌在列表或引用块里

如果用户提供的数据点超过上述限制（比如有 200 个时间点），请你**自己做聚合或截断**（按区间聚合到 ≤ 50 个代表点，或挑选有代表性的时点），不要把全集塞进 dataset.data。聚合方式可以在正文里用一句话说明。

表格生成（table）：
使用标准 Markdown 表格语法，系统会自动渲染为真实 Word 表格：

| 列 1 | 列 2 | 列 3 |
| --- | --- | --- |
| 数据 | 数据 | 数据 |

表格前后必须各有一个空行。表格标题用单独一段写在表格上方，格式「表 N：xxx」。

注意：用户上传的文档若原本含图片，由于技术限制你看不到图片二进制内容，只能看到文字。如果用户提到「原文中已有的图」，请基于上下文文字描述重新生成。`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RevisionStatus = 'processing' | 'completed' | 'failed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 文件类型白名单校验。在 createRevision 第一步调用，确保不支持的格式
 * 在建单/冻结/上传任何副作用之前就被 400 拒绝。
 */
export function validateRevisionFileTypes(files: Express.Multer.File[]): void {
  for (const file of files) {
    const ext = getFileExtension(file.originalname);
    if (!SUPPORTED_REVISION_EXTENSIONS.has(ext)) {
      throw new AppError(
        400,
        `不支持的文件类型：${file.originalname}。当前支持 PDF、DOCX、PNG/JPG/WEBP/GIF 图片、TXT/MD 纯文本。`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Word-count estimation（按字精确计费）
// ---------------------------------------------------------------------------
//
// 旧逻辑（file.size / 6 估算 PDF、图片硬编码 2000 字）会把 6.5MB PDF 估成 100 万字，
// 导致用户两万多积分被报"余额不足"。新逻辑：
//   - PDF: 真用 pdf-parse 解析 + 30s 超时，扫描件检测靠 isMostlyGarbage（与评审一致）
//   - DOCX/TXT/MD: 真解析（不再加 1.2 缓冲，结算时按真实字数退差）
//   - 图片: 每张固定 100 字（约 20 积分），象征性覆盖 Claude Vision 处理成本
// 估算口径与 executeRevision 第 4 步的结算口径都用同一个 countWords。

const REVISION_IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'tiff',
  'tif',
  'heic',
  'heif',
]);
const REVISION_IMAGE_WORDS_PER_FILE = 100;
const REVISION_REFERENCE_WORDS_PER_FILE = 50;
const REVISION_MAIN_ARTICLE_BUFFER = 1.2;
const REVISION_PDF_PARSE_TIMEOUT_MS = 30_000;
const REVISION_RAW_TEXT_SAMPLE_CHARS = 1500;

export interface RevisionFileEstimate {
  filename: string;
  words: number;
  isScannedPdf: boolean;
  /** 前 1500 字纯文本样本，用于 GPT-5.4 主文章识别。图片为 undefined。*/
  rawTextSample?: string;
  /** 文件扩展名（小写，不含点）。供主文章识别 / 计费分类使用。*/
  ext: string;
  /** 是否图片。*/
  isImage: boolean;
}

/**
 * 取前 1500 字作为 GPT 识别样本（保留段落结构）。
 */
function sampleText(text: string): string {
  const trimmed = (text || '').trim();
  if (trimmed.length <= REVISION_RAW_TEXT_SAMPLE_CHARS) return trimmed;
  return trimmed.slice(0, REVISION_RAW_TEXT_SAMPLE_CHARS);
}

/**
 * 单文件字数估算。供 estimate 路由（增量预估）和 createRevision（建单前真解析）共用。
 * - 扫描件 PDF / 解析超时 / pdf-parse 抛错 → 返回 isScannedPdf=true，由上层决定是否拒绝
 * - 不抛错（除非 docx 内容空 / 不支持的扩展名）
 */
export async function estimateRevisionForFile(
  file: { originalname: string; buffer: Buffer },
): Promise<RevisionFileEstimate> {
  const ext = (file.originalname.toLowerCase().split('.').pop() || '');

  if (REVISION_IMAGE_EXTS.has(ext)) {
    return {
      filename: file.originalname,
      words: REVISION_IMAGE_WORDS_PER_FILE,
      isScannedPdf: false,
      ext,
      isImage: true,
      // 图片不传 rawTextSample
    };
  }

  if (ext === 'docx') {
    let text: string;
    try {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value || '';
    } catch {
      throw new AppError(400, `Word 文档 ${file.originalname} 解析失败，请检查文件是否完好。`);
    }
    if (!text.trim()) {
      throw new AppError(400, `Word 文档 ${file.originalname} 内容为空或无法解析。`);
    }
    return {
      filename: file.originalname,
      words: countWords(text),
      isScannedPdf: false,
      rawTextSample: sampleText(text),
      ext,
      isImage: false,
    };
  }

  if (['txt', 'md', 'markdown'].includes(ext)) {
    const text = file.buffer.toString('utf8');
    return {
      filename: file.originalname,
      words: countWords(text),
      isScannedPdf: false,
      rawTextSample: sampleText(text),
      ext,
      isImage: false,
    };
  }

  if (ext === 'pdf') {
    let parseResult: { text: string };
    try {
      parseResult = await Promise.race([
        loadPdfParse()(file.buffer),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('PDF_PARSE_TIMEOUT')),
            REVISION_PDF_PARSE_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch {
      // 超时 / pdf-parse 抛错 → 一律按扫描件兜底，不抛错
      return {
        filename: file.originalname,
        words: 0,
        isScannedPdf: true,
        ext,
        isImage: false,
      };
    }
    const text = (parseResult.text || '').trim();
    if (text.length === 0 || isMostlyGarbage(text)) {
      return {
        filename: file.originalname,
        words: 0,
        isScannedPdf: true,
        ext,
        isImage: false,
      };
    }
    return {
      filename: file.originalname,
      words: countWords(text),
      isScannedPdf: false,
      rawTextSample: sampleText(text),
      ext,
      isImage: false,
    };
  }

  // 兜底：理论上 validateRevisionFileTypes 已经拦截，走到这里说明白名单和分支不一致
  throw new AppError(400, `不支持的文件类型：${file.originalname}。`);
}

/**
 * 多文件并行估算。供 createRevision 内部用，也供 POST /api/revision/estimate-precise 用。
 *
 * 模式 1（默认 detectMainArticle=false）：
 *   - 仅返回 totalWords / perFile / scannedFilenames（粗估算，不调 GPT）
 *   - 用于"上传材料原始总字数"展示
 *
 * 模式 2（detectMainArticle=true）：
 *   - 额外调用 GPT-5.4 article_detection 识别主文章
 *   - 计算精准冻结字数：ceil(主文章字数 × 1.2) + 参考材料数 × 50 + 图片数 × 100
 *   - 返回 mainArticleFilenames / preciseFrozenWords / preciseFrozenAmount / breakdown
 *   - GPT 失败自动 fallback 启发式（不抛错）
 */
export async function estimateRevisionTotal(
  files: Express.Multer.File[],
  opts?: { detectMainArticle?: boolean },
): Promise<{
  totalWords: number;
  perFile: RevisionFileEstimate[];
  scannedFilenames: string[];
  mainArticleFilenames?: string[];
  preciseFrozenWords?: number;
  preciseFrozenAmount?: number;
  detectionReasoning?: string;
  breakdown?: {
    mainArticleWords: number;
    referenceCount: number;
    imageCount: number;
  };
}> {
  const perFile = await Promise.all(files.map((f) => estimateRevisionForFile(f)));
  const totalWords = perFile.reduce((sum, f) => sum + f.words, 0);
  const scannedFilenames = perFile.filter((f) => f.isScannedPdf).map((f) => f.filename);

  if (!opts?.detectMainArticle) {
    return { totalWords, perFile, scannedFilenames };
  }

  // 扫描件 PDF 在精准估算时跳过（让上层先拒绝）
  if (scannedFilenames.length > 0) {
    return { totalWords, perFile, scannedFilenames };
  }

  // 调用 GPT-5.4 识别主文章
  const detectionInput: ArticleDetectionFile[] = perFile.map((f) => ({
    filename: f.filename,
    ext: f.ext,
    words: f.words,
    isImage: f.isImage,
    rawTextSample: f.rawTextSample,
  }));
  const detection: ArticleDetectionResult = await detectMainArticle({
    files: detectionInput,
  });

  // 后置兜底：如果 GPT 和启发式都没挑出主文章（极端：全是图片），并且有非图片文件，
  // 取字数最大的非图片当主文章（不让用户全免费白嫖修改）
  let mainArticleFilenames = detection.mainArticleFilenames;
  let detectionReasoning = detection.reasoning;
  if (mainArticleFilenames.length === 0) {
    const nonImages = perFile.filter((f) => !f.isImage);
    if (nonImages.length > 0) {
      const winner = nonImages.reduce((best, cur) => (cur.words > best.words ? cur : best));
      mainArticleFilenames = [winner.filename];
      detectionReasoning =
        `${detection.reasoning}; 后置兜底：识别 0 份主文章但有非图片文件，取字数最大的 ${winner.filename}`;
    }
    // 全是图片：mainArticleFilenames 保持空数组，公式里主文章字数 = 0
  }

  const mainArticleWords = perFile
    .filter((f) => mainArticleFilenames.includes(f.filename))
    .reduce((sum, f) => sum + f.words, 0);
  const referenceCount = perFile.filter(
    (f) => !mainArticleFilenames.includes(f.filename) && !f.isImage,
  ).length;
  const imageCount = perFile.filter((f) => f.isImage).length;

  const preciseFrozenWords =
    Math.ceil(mainArticleWords * REVISION_MAIN_ARTICLE_BUFFER) +
    referenceCount * REVISION_REFERENCE_WORDS_PER_FILE +
    imageCount * REVISION_IMAGE_WORDS_PER_FILE;
  const pricePerWord = await getRevisionPricePerWord();
  const preciseFrozenAmount = Math.ceil(preciseFrozenWords * pricePerWord);

  return {
    totalWords,
    perFile,
    scannedFilenames,
    mainArticleFilenames,
    preciseFrozenWords,
    preciseFrozenAmount,
    detectionReasoning,
    breakdown: {
      mainArticleWords,
      referenceCount,
      imageCount,
    },
  };
}

// 按字精确计费：cost = ceil(字数 × 单价)。
// 调用方负责把 system_config.revision_price_per_word 解析成 number 后传入。
function computeCost(wordCount: number, pricePerWord: number): number {
  return Math.ceil(wordCount * pricePerWord);
}

// 读取并解析 revision_price_per_word，兜底 0.2。
// configService 里小数是以 JSON 字符串落库的，用 Number() 转一下。
export async function getRevisionPricePerWord(): Promise<number> {
  const raw = await getConfig('revision_price_per_word');
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.2;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function extractTextFromResponse(response: any): string {
  if (!response?.content || !Array.isArray(response.content)) {
    throw new AppError(500, 'AI 返回结果格式异常。');
  }

  const textBlocks = response.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text);

  if (textBlocks.length === 0) {
    throw new AppError(500, 'AI 未返回任何文本结果。');
  }

  return textBlocks.join('\n\n');
}

function getNow(): number {
  return Date.now();
}

/**
 * 构造给 Claude 的"主文章 / 参考材料"分组说明，让 Claude 知道改哪份不改哪份。
 *
 * 兼容性：mainArticleFilenames 为空数组（旧任务 / cleanup 重试）时返回空字符串，
 * userMessage 完全保持旧行为不变。
 */
function buildFileRoleSection(
  materialBlocks: ReadonlyArray<unknown>,
  mainArticleFilenames: string[],
): string {
  if (!mainArticleFilenames || mainArticleFilenames.length === 0) {
    return '';
  }

  const allTitles = materialBlocks
    .map((b) => {
      const title = (b as { title?: unknown }).title;
      return typeof title === 'string' ? title : '';
    })
    .filter(Boolean);
  if (allTitles.length === 0) return '';

  const mainSet = new Set(mainArticleFilenames);
  const mainList = allTitles.filter((t) => mainSet.has(t));
  const refList = allTitles.filter((t) => !mainSet.has(t));

  if (mainList.length === 0) return '';

  const lines: string[] = ['', '【文件角色说明】'];
  lines.push('');
  lines.push('主文章（这是用户要修改的目标文档。你的输出必须是这份文档的修改后完整版）：');
  for (const name of mainList) lines.push(`- ${name}`);

  if (refList.length > 0) {
    lines.push('');
    lines.push('参考材料（仅用于参考、引用、检索；绝对不要修改它们的内容，也绝对不要把它们的内容原样输出到结果里）：');
    for (const name of refList) lines.push(`- ${name}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// File upload (for revision_files table)
// ---------------------------------------------------------------------------

async function uploadRevisionFiles(
  revisionId: string,
  files: Express.Multer.File[],
): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    // Supabase Storage 路径必须 ASCII；用户原文件名可能含中文，所以只用扩展名 + 索引
    const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ext.length > 0 && ext.length <= 8 ? ext : 'bin';
    const storagePath = `revisions/${revisionId}/material-${getNow()}-${i}.${safeExt}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('task-files')
      .upload(storagePath, file.buffer, { contentType: file.mimetype });

    if (uploadError) {
      throw new AppError(500, `文件 ${file.originalname} 上传失败，请稍后重试。`);
    }

    const { error: dbError } = await supabaseAdmin
      .from('revision_files')
      .insert({
        revision_id: revisionId,
        category: 'material',
        original_name: file.originalname,
        storage_path: storagePath,
        file_size: file.size,
        mime_type: file.mimetype,
      });

    if (dbError) {
      await supabaseAdmin.storage.from('task-files').remove([storagePath]);
      throw new AppError(500, '文件记录保存失败。');
    }
  }
}

// ---------------------------------------------------------------------------
// Core: create revision
// ---------------------------------------------------------------------------

export async function createRevision(
  userId: string,
  instructions: string,
  files: Express.Multer.File[],
) {
  // 0. 文件类型白名单（前置校验：在建单、冻结、上传前就拒绝）
  validateRevisionFileTypes(files);

  // 1. 主动检查是否有进行中的修改（友好提示，唯一索引也会兜底）
  const { data: active } = await supabaseAdmin
    .from('revisions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .maybeSingle();

  if (active) {
    throw new AppError(400, '您当前有一个正在处理的修改请求，请等待完成后再提交新的修改。');
  }

  // 2. 估算字数（带 GPT-5.4 主文章识别）
  //    精准冻结公式：ceil(主文章字数 × 1.2) + 参考材料数 × 50 + 图片数 × 100
  //    GPT 失败自动 fallback 启发式（docx 字数最大 → 非图片字数最大），不会抛错
  const estimateResult = await estimateRevisionTotal(files, { detectMainArticle: true });
  const { perFile, scannedFilenames } = estimateResult;

  if (scannedFilenames.length > 0) {
    throw new AppError(
      400,
      `文件 ${scannedFilenames.join('、')} 看起来是扫描件 PDF，无法修改文字内容，请改上传 .docx 或文字版 PDF。`,
    );
  }

  const frozenAmount = estimateResult.preciseFrozenAmount!;
  const mainArticleFilenames = estimateResult.mainArticleFilenames!;
  const breakdown = estimateResult.breakdown!;

  // 3. 余额前置校验：余额不足直接抛带数字的 InsufficientBalanceError，
  //    不创建任何 DB 记录、不冻结、不触发 revisions 部分唯一索引。
  const wallet = await getBalance(userId);
  console.log(
    `[revision:estimate] userId=${userId} mainArticles=${JSON.stringify(mainArticleFilenames)} ` +
      `mainWords=${breakdown.mainArticleWords} refCount=${breakdown.referenceCount} imgCount=${breakdown.imageCount} ` +
      `preciseWords=${estimateResult.preciseFrozenWords} amount=${frozenAmount} balance=${wallet.balance} ` +
      `perFile=${JSON.stringify(perFile.map((f) => ({ filename: f.filename, words: f.words })))} ` +
      `reasoning="${estimateResult.detectionReasoning}"`,
  );
  if (frozenAmount > wallet.balance) {
    throw new InsufficientBalanceError({ required: frozenAmount, current: wallet.balance });
  }

  // 4. 插入 revision 记录（先建单，需要 id 给后续文件路径用）
  //    main_article_filenames 写进 DB 让 executeRevision 在调 Claude 时用得上
  const { data: revision, error: insertError } = await supabaseAdmin
    .from('revisions')
    .insert({
      user_id: userId,
      instructions,
      status: 'processing',
      frozen_credits: frozenAmount,
      main_article_filenames: mainArticleFilenames,
    })
    .select('*')
    .single();

  if (insertError || !revision) {
    // 唯一索引冲突说明有并发的进行中修改
    if (insertError?.code === '23505') {
      throw new AppError(400, '您当前有一个正在处理的修改请求，请等待完成后再提交新的修改。');
    }
    throw new AppError(500, '创建修改请求失败。');
  }

  // 5. 冻结积分（独立 try：冻结失败时还没有任何资金动作，直接清理记录即可）
  //    注意：第 3 步已经做过余额前置校验，但竞态场景（用户两个浏览器同时提）
  //    下仍可能被另一笔扣走 → freezeCredits 抛 InsufficientBalanceError（旧文案，可接受）
  try {
    await freezeCredits(userId, frozenAmount, 'revision', revision.id, '文章修改冻结积分');
  } catch (freezeError) {
    await supabaseAdmin.from('revisions').delete().eq('id', revision.id);
    throw freezeError;
  }

  // 6. 上传文件 + 启动异步执行（独立 try：失败时必须先 refund 再标记 failed，不能删除记录）
  try {
    await uploadRevisionFiles(revision.id, files);

    // 启动异步执行（不阻塞响应）
    executeRevision(revision.id, userId).catch((err) => {
      captureError(err, 'revision.execute', { revisionId: revision.id });
    });

    return revision;
  } catch (uploadError) {
    // 关键修复：先退款，再标记 failed（不删除，保留审计）
    try {
      await refundCredits(
        userId,
        frozenAmount,
        'revision',
        revision.id,
        '材料上传失败自动退款',
      );
    } catch (refundError) {
      captureError(refundError, 'revision.create_refund_failed', {
        revisionId: revision.id,
      });
    }

    await supabaseAdmin
      .from('revisions')
      .update({
        status: 'failed',
        failure_reason: '材料上传失败，积分已自动退回。',
        refunded: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', revision.id);

    throw uploadError;
  }
}

// ---------------------------------------------------------------------------
// Core: execute revision (async background)
// ---------------------------------------------------------------------------

export async function executeRevision(revisionId: string, userId: string) {
  let frozenCreditsAmount = 0;
  let alreadySettled = false; // 关键：跟踪是否已经结算，避免重复退款 / 错误退款

  try {
    // 1. Load revision
    const { data: revision, error: loadError } = await supabaseAdmin
      .from('revisions')
      .select('*')
      .eq('id', revisionId)
      .single();

    if (loadError || !revision) throw new AppError(500, '修改记录不存在。');
    frozenCreditsAmount = revision.frozen_credits;

    // 2. Prepare material content for Claude
    const materialBlocks = await getRevisionMaterialContent(revisionId);

    // 2.5 主文章识别结果：由 createRevision 里 GPT-5.4 article_detection 写入。
    //     旧任务（cleanup 重试 / 历史数据）main_article_filenames 是空数组 → 走旧 prompt 行为。
    const mainArticleFilenames: string[] = Array.isArray(revision.main_article_filenames)
      ? revision.main_article_filenames
      : [];

    // 3. Call Anthropic API with adaptive extended thinking + max effort
    //    Opus 4.6 推荐写法：thinking.adaptive + output_config.effort=max
    //    （旧写法 thinking.enabled+budget_tokens 已 deprecated）
    //    output_config 是 SDK 类型尚未补齐的新字段，用 spread + as any 透传
    //
    //    系统提示见顶部 REVISION_SYSTEM_PROMPT 常量。
    //    用户消息用结构化模板，把任务/指令/输出要求三段分开，让 Claude 更难跑偏。
    //    max_tokens 提到 80000：旧值 16000 对长论文会被截断；如果上游拒绝再降到 32000。
    const fileRoleSection = buildFileRoleSection(materialBlocks, mainArticleFilenames);
    const userMessage = `【任务】基于上方提供的原始文档，按以下指令输出修改后的完整论文。
${fileRoleSection}
【用户指令】
${revision.instructions}

【输出要求】
- 输出完整的修改后论文全文
- 严格基于原文做最小必要的修改
- 图表用 [CHART_BEGIN]…[CHART_END] DSL 输出
- 表格用 Markdown 表格输出
- 直接以论文内容开始，正文结束即停止`;

    const response = await anthropic.messages
      .stream({
        model: 'claude-opus-4-6',
        max_tokens: 80000,
        system: REVISION_SYSTEM_PROMPT,
        thinking: {
          type: 'adaptive',
        } as any,
        ...({ output_config: { effort: 'max' } } as any),
        messages: [
          {
            role: 'user',
            content: [
              ...materialBlocks,
              {
                type: 'text',
                text: userMessage,
              },
            ],
          },
        ],
      })
      .finalMessage();

    // 验证 extended thinking 是否真的被上游执行：sub2api 不会动 thinking 字段，
    // 但如果 model id 在 normalize 阶段被映射成不支持 adaptive 的版本，会被静默忽略。
    // thinking_blocks > 0 → 已生效；= 0 → 切 explicit 模式 {type:'enabled',budget_tokens:8000}
    const thinkingBlocks = response.content.filter((b) => (b as any).type === 'thinking');
    console.log(
      `[revision] anthropic response: stop=${response.stop_reason}, ` +
        `blocks=${response.content.length}, thinking_blocks=${thinkingBlocks.length}, ` +
        `usage=${JSON.stringify(response.usage)}`,
    );

    // 4. Extract result text + 解析图表 DSL + 渲染图表
    //    rawText 含 [CHART_BEGIN]…[CHART_END] 块
    //    parseRevisionOutput 会把它替换为 [[CHART_PLACEHOLDER_N]] 占位 token
    //    并返回需要渲染的 charts 数组
    const rawText = extractTextFromResponse(response);
    const { text: textWithPlaceholders, charts } = parseRevisionOutput(rawText);

    // 并发渲染所有图表（每张独立 retry，互不影响；失败的会在 docx 里降级为占位段，
    // 整篇文档不会因为单图失败而 fail）
    const rendered = await renderCharts(charts.map((c) => c.spec));
    const renderedOk = rendered.filter((r) => r.png).length;
    console.log(
      `[revision] charts parsed=${charts.length}, rendered_ok=${renderedOk}, ` +
        `rendered_failed=${charts.length - renderedOk}`,
    );

    // 构造 token → RenderedChart 的映射表，给 docx builder 用
    const mediaMap = new Map<string, RenderedChart>();
    charts.forEach((c, idx) => {
      mediaMap.set(c.token, rendered[idx]!);
    });

    // 字数统计：去掉占位 token 再算，避免占位字符把字数虚高
    const cleanForCount = textWithPlaceholders.replace(/\[\[CHART_PLACEHOLDER_\d+\]\]/g, '');
    const wordCount = countWords(cleanForCount);
    // 按字精确计费：cost = ceil(字数 × 单价)，结算口径必须和 createRevision 冻结时一致
    const pricePerWord = await getRevisionPricePerWord();
    const actualCost = computeCost(wordCount, pricePerWord);
    const costToSettle = Math.min(actualCost, frozenCreditsAmount);

    // 5. Generate Word document with embedded charts + native tables
    const docBuffer = await buildFormattedPaperDocBufferWithMedia(
      textWithPlaceholders,
      mediaMap,
    );
    // 面向用户的展示名（下载文件名）可以用中文
    const docFileName = `修改结果-${new Date().toISOString().slice(0, 10)}.docx`;
    // 但 Supabase Storage 路径必须纯 ASCII，否则上传会被拒绝
    const docStoragePath = `revisions/${revisionId}/revised-${getNow()}.docx`;

    const retentionDays = parseInt(await getConfig('result_file_retention_days') || '3', 10);
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();

    // 6. 上传 Word 到 storage（必须检查错误）
    const { error: uploadError } = await supabaseAdmin.storage
      .from('task-files')
      .upload(docStoragePath, docBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

    if (uploadError) {
      throw new AppError(500, '保存修改结果文件失败。');
    }

    // 7. 写入 revision_files（必须检查错误，失败时清理已上传的存储文件）
    const { error: insertFileError } = await supabaseAdmin
      .from('revision_files')
      .insert({
        revision_id: revisionId,
        category: 'revision_output',
        original_name: docFileName,
        storage_path: docStoragePath,
        file_size: docBuffer.length,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        expires_at: expiresAt,
      });

    if (insertFileError) {
      // 清理孤儿存储文件
      await supabaseAdmin.storage.from('task-files').remove([docStoragePath]);
      throw new AppError(500, '保存修改结果记录失败。');
    }

    // 8. 更新 revision 为 completed（必须检查错误）
    const { error: updateError } = await supabaseAdmin
      .from('revisions')
      .update({
        status: 'completed',
        // 保存"占位 token 已剥离"的纯文本版本，避免 DB 里出现 [[CHART_PLACEHOLDER_N]]
        // （图表本体已嵌进 docx 文件了，DB 文本只是给前端预览/审计用）
        result_text: cleanForCount,
        word_count: wordCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', revisionId);

    if (updateError) {
      throw new AppError(500, '更新修改状态失败。');
    }

    // 9. 最后才结算积分（所有副作用已经稳定落库）
    await settleCredits(userId, costToSettle);
    alreadySettled = true;

    // 10. 退差额（如果有）
    const refundAmount = frozenCreditsAmount - costToSettle;
    if (refundAmount > 0) {
      await refundCredits(userId, refundAmount, 'revision', revisionId, '修改费用差额退还');
    }

  } catch (error: unknown) {
    // 关键修复：只有还没结算的情况下才能退完整 frozen
    // 已经结算过的话（理论上不该走到这里，因为步骤 9 之后没有抛出点），不应再尝试退款
    if (frozenCreditsAmount > 0 && !alreadySettled) {
      try {
        await refundCredits(
          userId,
          frozenCreditsAmount,
          'revision',
          revisionId,
          '修改失败自动退款',
        );
        await supabaseAdmin
          .from('revisions')
          .update({ refunded: true })
          .eq('id', revisionId);
      } catch (refundError) {
        captureError(refundError, 'revision.refund_failure', { revisionId });
      }
    }

    const failureReason = error instanceof AppError
      ? error.userMessage
      : '修改过程中发生错误，请稍后重试。';

    await supabaseAdmin
      .from('revisions')
      .update({
        status: 'failed',
        failure_reason: failureReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', revisionId);

    captureError(error, 'revision.execute_failed', { revisionId });
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export async function getRevision(revisionId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('revisions')
    .select('*')
    .eq('id', revisionId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new AppError(404, '修改记录不存在。');
  }

  // Load files
  const { data: files } = await supabaseAdmin
    .from('revision_files')
    .select('id, category, original_name, file_size, mime_type, created_at, expires_at')
    .eq('revision_id', revisionId)
    .order('created_at', { ascending: true });

  return { revision: data, files: files || [] };
}

export async function getRevisionCurrent(userId: string) {
  const { data } = await supabaseAdmin
    .from('revisions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .maybeSingle();

  if (!data) return null;

  const { data: files } = await supabaseAdmin
    .from('revision_files')
    .select('id, category, original_name, file_size, mime_type, created_at, expires_at')
    .eq('revision_id', data.id)
    .order('created_at', { ascending: true });

  return { revision: data, files: files || [] };
}

export async function getRevisionList(
  userId: string,
  limit = 20,
  offset = 0,
) {
  const { data, error, count } = await supabaseAdmin
    .from('revisions')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new AppError(500, '获取修改记录失败。');
  }

  return { revisions: data || [], total: count || 0 };
}

export async function getRevisionDownloadUrl(
  revisionId: string,
  fileId: string,
  userId: string,
) {
  // Verify ownership
  const { data: revision } = await supabaseAdmin
    .from('revisions')
    .select('user_id')
    .eq('id', revisionId)
    .single();

  if (!revision || revision.user_id !== userId) {
    throw new AppError(404, '文件不存在。');
  }

  const { data: file } = await supabaseAdmin
    .from('revision_files')
    .select('id, storage_path, original_name, expires_at')
    .eq('id', fileId)
    .eq('revision_id', revisionId)
    .single();

  if (!file) {
    throw new AppError(404, '文件不存在。');
  }

  if (file.expires_at && new Date(file.expires_at) < new Date()) {
    throw new AppError(410, '文件已过期，无法下载。');
  }

  const { data, error } = await supabaseAdmin.storage
    .from('task-files')
    .createSignedUrl(file.storage_path, 3600);

  if (error || !data) {
    throw new AppError(500, '生成下载链接失败。');
  }

  return { url: data.signedUrl, filename: file.original_name };
}
