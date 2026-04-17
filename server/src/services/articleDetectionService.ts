import { streamResponseText } from '../lib/openai';
import { buildMainOpenAIResponsesOptions } from '../lib/openaiMainConfig';

// ---------------------------------------------------------------------------
// 文章修改：主文章识别
//
// 用户在 /dashboard/revision 上传多个文件，可能是「1 篇待修改的主文章 + N 篇参考材料」。
// 这个 service 负责调 GPT-5.4 (`article_detection` stage) 从文件名 + 字数 + 前 1500 字
// 内容样本里识别出"哪些是主文章"。识别结果用来：
//   1. 精准计算冻结字数（主文章 × 1.2 + 参考 × 50 + 图片 × 100）
//   2. 写进 Claude 的 user prompt 告诉它只改主文章不改参考
//
// 失败兜底：超时 / JSON 校验失败 / hallucinated filename → 启发式（docx 字数最大 →
// 非图片字数最大），绝不抛错（不能阻塞用户提交）。
// ---------------------------------------------------------------------------

const ARTICLE_DETECTION_TIMEOUT_MS = 60 * 1000; // 60 秒
const ARTICLE_DETECTION_MAX_ATTEMPTS = 2; // 第 1 次 + 1 次重试
const RAW_TEXT_SAMPLE_MAX_CHARS = 1500;

const IMAGE_EXTS = new Set([
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

const DOCX_EXTS = new Set(['docx']);

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface ArticleDetectionFile {
  filename: string;
  ext: string;
  words: number;
  isImage: boolean;
  /** 已解析的纯文本前 1500 字（PDF/DOCX/TXT/MD），图片传 undefined。*/
  rawTextSample?: string;
}

export interface ArticleDetectionInput {
  files: ArticleDetectionFile[];
}

export interface ArticleDetectionResult {
  /** 被识别为主文章的文件名列表。可能 0 份（极端：全是图片）或多份。 */
  mainArticleFilenames: string[];
  /** GPT 给出的判定理由（debug 用）；启发式 fallback 时也会有简短说明。 */
  reasoning: string;
  /** 调用是否走了 GPT；false 表示直接走启发式（如全是图片或全是空文件）。 */
  usedGpt: boolean;
  /** GPT 是否失败被启发式接管（true = GPT 失败 fallback 了）。 */
  fellBackToHeuristic: boolean;
}

// ---------------------------------------------------------------------------
// DI 接口（便于 mock OpenAI 做单测）
// ---------------------------------------------------------------------------

export interface ArticleDetectionDeps {
  /** 跑 GPT-5.4 article_detection stage，返回原始 text。默认走 OpenAI Responses API。*/
  runDetectionModel: (input: { systemPrompt: string; userMessage: string }) => Promise<{
    text: string;
  }>;
}

async function defaultRunDetectionModel(input: {
  systemPrompt: string;
  userMessage: string;
}): Promise<{ text: string }> {
  const result = await withDetectionTimeout(
    streamResponseText({
      ...buildMainOpenAIResponsesOptions('article_detection'),
      instructions: input.systemPrompt,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: input.userMessage }],
        },
      ],
    } as any),
    ARTICLE_DETECTION_TIMEOUT_MS,
  );
  return { text: result.text };
}

export const defaultArticleDetectionDeps: ArticleDetectionDeps = {
  runDetectionModel: defaultRunDetectionModel,
};

class ArticleDetectionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`article_detection timed out after ${timeoutMs}ms`);
    this.name = 'ArticleDetectionTimeoutError';
  }
}

function withDetectionTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ArticleDetectionTimeoutError(timeoutMs)),
      timeoutMs,
    );
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Prompt 构建
// ---------------------------------------------------------------------------

const ARTICLE_DETECTION_SYSTEM_PROMPT = `你是一个文件分类助手，专门帮用户识别"哪份文件是要修改的主文章"。

用户在论文修改场景里通常会上传多份文件：
- **主文章（main article）**：用户的论文初稿、待修改的稿子，文件名常含 final / draft / paper / essay / report / submission / 论文 / 文章 / 稿；这是用户真正要让 AI 改的目标文档
- **评分标准（rubric）**：评分规则、打分细则，文件名常含 rubric / criteria / marking / grading / 评分；不要修改
- **任务说明（brief）**：作业要求、任务指引，文件名常含 brief / assignment / task / instructions / guide / 任务 / 要求；不要修改
- **参考材料（reference）**：用户用来引用的其他论文 / 新闻 / 报告，跟主题相关但不是主文章；不要修改
- **图片（image）**：截图 / 配图，无文字内容，无法判断角色

你的任务：从用户上传的文件列表里挑出"主文章"。

判定原则（按优先级）：
1. 文件名最有信息量——含 paper / essay / draft / final / report / 论文 / 文章 / 稿 的优先
2. 文件名含 rubric / criteria / brief / assignment / 评分 / 要求 的明确不是主文章
3. 文件名是乱码（如 hash 字符串、UUID）时，看内容样本：是连贯的论文段落吗？引用 / 章节标题 / 首段陈述论点的，更可能是主文章
4. docx 比 pdf 更可能是用户自己写的主文章（PDF 一般是参考资料）
5. 字数最大的不一定是主文章——参考论文可能比主文章长

输出严格 JSON（不要 markdown 代码块、不要任何解释文本）：

{
  "main_article_filenames": ["filename_in_input_list_only.docx"],
  "reasoning": "用一两句话说明为什么这份是主文章、其他是参考"
}

约束：
- main_article_filenames 必须是输入文件列表里的文件名（精确匹配，不能编造）
- main_article_filenames 通常 1 份；如果用户明显上传了多份待改文章可以多选；如果完全无法判断就返回空数组
- reasoning 必须是中文、非空字符串`;

function buildDetectionUserMessage(files: ArticleDetectionFile[]): string {
  const lines: string[] = [];
  lines.push('以下是用户上传的所有文件，请挑出哪份是要修改的主文章：');
  lines.push('');
  files.forEach((f, idx) => {
    lines.push(`# 文件 ${idx + 1}`);
    lines.push(`- filename: ${f.filename}`);
    lines.push(`- 扩展名: .${f.ext}`);
    lines.push(`- 字数: ${f.words}`);
    if (f.isImage) {
      lines.push('- 类型: 图片（无文字内容）');
    } else if (f.rawTextSample && f.rawTextSample.trim()) {
      const sample = f.rawTextSample.slice(0, RAW_TEXT_SAMPLE_MAX_CHARS).trim();
      lines.push('- 内容样本（前 1500 字）：');
      lines.push('```');
      lines.push(sample);
      lines.push('```');
    } else {
      lines.push('- 内容样本: （空）');
    }
    lines.push('');
  });
  lines.push('请按规则判定，返回 JSON。');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON 解析（参考 scoringPromptService.parseScoringJson 的软解析模式）
// ---------------------------------------------------------------------------

function parseDetectionJson(text: string): Record<string, unknown> | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // fall through
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  return null;
}

interface ValidatedDetection {
  mainArticleFilenames: string[];
  reasoning: string;
}

/**
 * 硬校验：
 *  1. main_article_filenames 是数组
 *  2. 每项是非空字符串
 *  3. 每项必须在 inputFilenames 列表里（防 GPT hallucination）
 *  4. reasoning 是非空字符串
 * 失败抛错由调用方 catch 走重试 / fallback。
 */
function validateDetection(
  parsed: unknown,
  inputFilenames: Set<string>,
): ValidatedDetection {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('detection JSON 不是对象');
  }
  const obj = parsed as Record<string, unknown>;

  const raw = obj.main_article_filenames;
  if (!Array.isArray(raw)) {
    throw new Error('main_article_filenames 必须是数组');
  }
  const filenames: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error('main_article_filenames 每项必须是非空字符串');
    }
    if (!inputFilenames.has(item)) {
      throw new Error(`hallucinated filename: ${item}（不在输入文件列表里）`);
    }
    filenames.push(item);
  }

  const reasoning = obj.reasoning;
  if (typeof reasoning !== 'string' || !reasoning.trim()) {
    throw new Error('reasoning 必须是非空字符串');
  }

  return { mainArticleFilenames: filenames, reasoning: reasoning.trim() };
}

// ---------------------------------------------------------------------------
// 启发式 fallback（GPT 失败 / 跳过 GPT 时用）
// ---------------------------------------------------------------------------

/**
 * 启发式：
 *   1. 取所有 docx 中字数最大的（用户上传 docx 大概率是自己的主文章）
 *   2. 没 docx → 取所有非图片中字数最大的
 *   3. 都没有（全是图片）→ 返回空数组
 */
export function heuristicGuessMainArticle(
  files: ArticleDetectionFile[],
): { mainArticleFilenames: string[]; reasoning: string } {
  const docxes = files.filter((f) => DOCX_EXTS.has(f.ext) && !f.isImage);
  if (docxes.length > 0) {
    const winner = docxes.reduce((best, cur) => (cur.words > best.words ? cur : best));
    return {
      mainArticleFilenames: [winner.filename],
      reasoning: `启发式兜底：上传文件中字数最大的 docx (${winner.filename}, ${winner.words} 字) 视为主文章`,
    };
  }

  const nonImages = files.filter((f) => !f.isImage);
  if (nonImages.length > 0) {
    const winner = nonImages.reduce((best, cur) => (cur.words > best.words ? cur : best));
    return {
      mainArticleFilenames: [winner.filename],
      reasoning: `启发式兜底：上传文件中无 docx，取字数最大的非图片文件 (${winner.filename}, ${winner.words} 字) 视为主文章`,
    };
  }

  return {
    mainArticleFilenames: [],
    reasoning: '启发式兜底：上传全是图片，无可作为主文章的文本文件',
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 从用户上传的多个文件里识别"哪些是要修改的主文章"。
 *
 * 调用方（estimateRevisionTotal / createRevision）需要这个结果来：
 *   - 计算精准冻结字数（主文章 × 1.2 + 参考 × 50 + 图片 × 100）
 *   - 在 Claude prompt 里告诉它只改主文章
 *
 * **绝不抛错**：GPT 失败 / 超时 / JSON 校验失败都会走启发式兜底。
 */
export async function detectMainArticle(
  input: ArticleDetectionInput,
  deps: ArticleDetectionDeps = defaultArticleDetectionDeps,
): Promise<ArticleDetectionResult> {
  const files = input.files;

  // 边界 1：空文件列表 → 直接返回空（理论不应该发生，调用方应该已经校验）
  if (!files || files.length === 0) {
    return {
      mainArticleFilenames: [],
      reasoning: '输入文件列表为空',
      usedGpt: false,
      fellBackToHeuristic: false,
    };
  }

  // 边界 2：全是图片 → 直接走启发式（GPT 也认不出，没必要花钱）
  const allImages = files.every((f) => f.isImage);
  if (allImages) {
    const heuristic = heuristicGuessMainArticle(files);
    return {
      ...heuristic,
      usedGpt: false,
      fellBackToHeuristic: false,
    };
  }

  // 边界 3：只有一个非图片文件 → 直接当主文章（无需调 GPT）
  const nonImages = files.filter((f) => !f.isImage);
  if (nonImages.length === 1) {
    return {
      mainArticleFilenames: [nonImages[0].filename],
      reasoning: `只有一个非图片文件 (${nonImages[0].filename})，直接视为主文章`,
      usedGpt: false,
      fellBackToHeuristic: false,
    };
  }

  // 主路径：调 GPT-5.4 + 重试
  const inputFilenames = new Set(files.map((f) => f.filename));
  const userMessage = buildDetectionUserMessage(files);
  const errors: string[] = [];

  for (let attempt = 1; attempt <= ARTICLE_DETECTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { text } = await deps.runDetectionModel({
        systemPrompt: ARTICLE_DETECTION_SYSTEM_PROMPT,
        userMessage,
      });
      const parsed = parseDetectionJson(text);
      if (!parsed) {
        throw new Error('JSON 解析失败');
      }
      const validated = validateDetection(parsed, inputFilenames);

      // GPT 返回 0 份主文章 → 启发式兜底
      if (validated.mainArticleFilenames.length === 0) {
        const heuristic = heuristicGuessMainArticle(files);
        return {
          mainArticleFilenames: heuristic.mainArticleFilenames,
          reasoning: `GPT 返回 0 份主文章；${heuristic.reasoning}`,
          usedGpt: true,
          fellBackToHeuristic: true,
        };
      }

      return {
        mainArticleFilenames: validated.mainArticleFilenames,
        reasoning: validated.reasoning,
        usedGpt: true,
        fellBackToHeuristic: false,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.push(`attempt ${attempt}: ${reason}`);
      console.warn(`[article_detection] attempt ${attempt}/${ARTICLE_DETECTION_MAX_ATTEMPTS} failed: ${reason}`);
      // 继续下一次重试（直到 max attempts）
    }
  }

  // 所有 GPT 重试都失败 → 启发式兜底
  const heuristic = heuristicGuessMainArticle(files);
  console.warn(
    `[article_detection] all GPT attempts failed, fallback to heuristic. errors=${errors.join(' | ')}`,
  );
  return {
    mainArticleFilenames: heuristic.mainArticleFilenames,
    reasoning: `GPT 调用失败 (${errors.length} 次)；${heuristic.reasoning}`,
    usedGpt: true,
    fellBackToHeuristic: true,
  };
}
