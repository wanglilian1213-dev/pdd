import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { captureError } from '../lib/errorMonitor';
import { freezeCredits, settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import { streamResponseText } from '../lib/openai';
import { buildMainOpenAIResponsesOptions } from '../lib/openaiMainConfig';
import {
  validateAndExtractScoringInputs,
  prepareScoringMaterialParts,
  normalizeFilename,
  defaultScoringMaterialDeps,
  getFileExtension,
  type ExtractedFileInfo,
  type ScoringMaterialDeps,
  type HintedRole,
  type StoredScoringFile,
  type ScoringInputPart,
} from './scoringMaterialService';
import {
  detectScenario,
  buildScoringSystemPrompt,
  buildScoringUserMessage,
  buildScoringRetryHint,
  parseScoringJson,
  validateScoringJson,
  type ScoringScenario,
  type ScoringResult,
} from './scoringPromptService';
import {
  buildScoringReportData,
  renderScoringReportPdf,
} from './scoringPdfService';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

// 评审单次 OpenAI 调用最多 20 分钟。这是硬上限：高 reasoning + 长 dimensions 可能
// 偶尔接近 10 分钟，但到 20 还在等就直接算失败退款，不让钱包里的冻结积分无限期被卡住。
const SCORING_STAGE_TIMEOUT_MS = 20 * 60 * 1000;

// JSON 格式错误最多重试几次（第 2 次会带错误摘要做 hint）
const SCORING_JSON_RETRY_MAX_ATTEMPTS = 2;

const DEFAULT_SCORING_PRICE_PER_WORD = 0.1;
const DEFAULT_RESULT_FILE_RETENTION_DAYS = 3;

// ---------------------------------------------------------------------------
// DI 接口（便于 mock OpenAI 做单测）
// ---------------------------------------------------------------------------

export interface ScoringServiceDeps {
  material: ScoringMaterialDeps;
  /**
   * 跑 GPT 并返回原始 text。输入是 system + user + parts 三段。
   * 默认实现走 OpenAI Responses API 流式累积。
   */
  runScoringModel: (input: ScoringModelInput) => Promise<{ text: string }>;
  /** 注入给测试用的"当前时间戳"，默认 Date.now。 */
  now: () => number;
  /** 注入给测试用的 PDF 渲染器，默认走 pdfkit。 */
  renderPdf: (
    result: ScoringResult,
    scenario: ScoringScenario,
    articleTitle: string | null,
  ) => Promise<Buffer>;
}

export interface ScoringModelInput {
  systemPrompt: string;
  userMessage: string;
  parts: ScoringInputPart[];
}

async function defaultRunScoringModel(
  input: ScoringModelInput,
): Promise<{ text: string }> {
  const result = await withScoringTimeout(
    streamResponseText({
      ...buildMainOpenAIResponsesOptions('scoring'),
      instructions: input.systemPrompt,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: input.userMessage },
            ...input.parts,
          ],
        },
      ],
    } as any),
    SCORING_STAGE_TIMEOUT_MS,
  );
  return { text: result.text };
}

async function defaultRenderPdf(
  result: ScoringResult,
  scenario: ScoringScenario,
  articleTitle: string | null,
): Promise<Buffer> {
  return renderScoringReportPdf(
    buildScoringReportData(result, scenario, articleTitle),
  );
}

export const defaultScoringServiceDeps: ScoringServiceDeps = {
  material: defaultScoringMaterialDeps,
  runScoringModel: defaultRunScoringModel,
  now: () => Date.now(),
  renderPdf: defaultRenderPdf,
};

// ---------------------------------------------------------------------------
// 超时包装
// ---------------------------------------------------------------------------

class ScoringTimeoutError extends AppError {
  constructor(timeoutMs: number) {
    super(500, '评审处理超时，请稍后重试。', `scoring timed out after ${timeoutMs}ms`);
    this.name = 'ScoringTimeoutError';
  }
}

function withScoringTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ScoringTimeoutError(timeoutMs)), timeoutMs);
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
// 辅助：费用估算和结算
// ---------------------------------------------------------------------------

async function readPricePerWord(): Promise<number> {
  const raw = await getConfig('scoring_price_per_word');
  if (raw === null || raw === undefined) return DEFAULT_SCORING_PRICE_PER_WORD;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) && num > 0 ? num : DEFAULT_SCORING_PRICE_PER_WORD;
}

function computeFrozenAmount(totalWords: number, pricePerWord: number): number {
  return Math.ceil(totalWords * pricePerWord);
}

/**
 * 按 GPT 回写的 detected_files 挑出 article 文件，查后端已落库的精确 word 数，求和；
 * clamp 到 [0, inputWordCount] 避免 GPT 误报；
 * fallback 到 inputWordCount 以保守退款（宁可少退也不要多扣用户）。
 */
export function computeSettledWords(
  result: ScoringResult,
  fileInfos: Array<{ originalName: string; extractedWordCount: number }>,
  inputWordCount: number,
): number {
  const articleNames = new Set(
    result.detected_files
      .filter((f) => f.role === 'article')
      .map((f) => normalizeFilename(f.filename)),
  );

  let sum = 0;
  for (const info of fileInfos) {
    if (articleNames.has(normalizeFilename(info.originalName))) {
      sum += Math.max(0, info.extractedWordCount);
    }
  }
  if (sum === 0) {
    // GPT 没识别到 article，或者文件名完全对不上。按冻结量全额结算。
    return inputWordCount;
  }
  return Math.min(Math.max(sum, 0), inputWordCount);
}

// ---------------------------------------------------------------------------
// 上传原始材料到 Storage（和 revisionService 的 uploadRevisionFiles 结构一致）
// ---------------------------------------------------------------------------

async function uploadScoringMaterials(
  scoringId: string,
  files: Express.Multer.File[],
  extracted: ExtractedFileInfo[],
  now: () => number,
): Promise<void> {
  if (files.length !== extracted.length) {
    throw new AppError(500, '文件数量不匹配，请稍后重试。');
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const info = extracted[i];

    const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ext.length > 0 && ext.length <= 8 ? ext : 'bin';
    const storagePath = `scorings/${scoringId}/material-${now()}-${i}.${safeExt}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('task-files')
      .upload(storagePath, file.buffer, { contentType: file.mimetype });

    if (uploadError) {
      throw new AppError(500, `文件 ${file.originalname} 上传失败，请稍后重试。`);
    }

    const { error: dbError } = await supabaseAdmin.from('scoring_files').insert({
      scoring_id: scoringId,
      category: 'material',
      original_name: file.originalname,
      storage_path: storagePath,
      file_size: file.size,
      mime_type: file.mimetype,
      hinted_role: info.hintedRole,
      extracted_word_count: info.wordCount,
    });

    if (dbError) {
      await supabaseAdmin.storage.from('task-files').remove([storagePath]);
      throw new AppError(500, '文件记录保存失败。');
    }
  }
}

// ---------------------------------------------------------------------------
// Core: createScoring
// ---------------------------------------------------------------------------

export async function createScoring(
  userId: string,
  files: Express.Multer.File[],
  deps: ScoringServiceDeps = defaultScoringServiceDeps,
) {
  // 1. 精确提取所有文件的字数 + 预判角色。扫描件 / 纯图片在这里前置拒绝，没冻结没建单。
  const extracted = await validateAndExtractScoringInputs(files, deps.material);

  // 2. 主动检查是否有进行中的评审（唯一部分索引兜底）
  const { data: active } = await supabaseAdmin
    .from('scorings')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .maybeSingle();

  if (active) {
    throw new AppError(
      400,
      '您当前有一个正在处理的评审请求，请等待完成后再提交新的评审。',
    );
  }

  // 3. 计算冻结金额
  const pricePerWord = await readPricePerWord();
  const totalWords = extracted.reduce((acc, info) => acc + info.wordCount, 0);
  const frozenAmount = computeFrozenAmount(totalWords, pricePerWord);

  // 4. 插入 scoring 记录
  const { data: scoring, error: insertError } = await supabaseAdmin
    .from('scorings')
    .insert({
      user_id: userId,
      status: 'processing',
      frozen_credits: frozenAmount,
      input_word_count: totalWords,
    })
    .select('*')
    .single();

  if (insertError || !scoring) {
    if (insertError?.code === '23505') {
      throw new AppError(
        400,
        '您当前有一个正在处理的评审请求，请等待完成后再提交新的评审。',
      );
    }
    throw new AppError(500, '创建评审请求失败。');
  }

  // 5. 冻结积分（独立 try：冻结失败还没动过资金，直接删记录即可）
  try {
    await freezeCredits(userId, frozenAmount, 'scoring', scoring.id, '文章评审冻结积分');
  } catch (freezeError) {
    await supabaseAdmin.from('scorings').delete().eq('id', scoring.id);
    throw freezeError;
  }

  // 6. 上传材料 + 启动异步执行（失败时必须先 refund 再标记 failed）
  try {
    await uploadScoringMaterials(scoring.id, files, extracted, deps.now);

    executeScoring(scoring.id, userId, deps).catch((err) => {
      captureError(err, 'scoring.execute', { scoringId: scoring.id });
    });

    return scoring;
  } catch (uploadError) {
    try {
      await refundCredits(
        userId,
        frozenAmount,
        'scoring',
        scoring.id,
        '评审材料上传失败自动退款',
      );
    } catch (refundError) {
      captureError(refundError, 'scoring.create_refund_failed', {
        scoringId: scoring.id,
      });
    }

    await supabaseAdmin
      .from('scorings')
      .update({
        status: 'failed',
        failure_reason: '材料上传失败，积分已自动退回。',
        refunded: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scoring.id);

    throw uploadError;
  }
}

// ---------------------------------------------------------------------------
// Core: executeScoring（异步后台执行）
// ---------------------------------------------------------------------------

export async function executeScoring(
  scoringId: string,
  userId: string,
  deps: ScoringServiceDeps = defaultScoringServiceDeps,
) {
  let frozenCreditsAmount = 0;
  let alreadySettled = false;

  try {
    // 1. Load scoring + files
    const { data: scoring, error: loadError } = await supabaseAdmin
      .from('scorings')
      .select('*')
      .eq('id', scoringId)
      .single();
    if (loadError || !scoring) throw new AppError(500, '评审记录不存在。');
    frozenCreditsAmount = scoring.frozen_credits;

    const { data: rawFiles, error: filesError } = await supabaseAdmin
      .from('scoring_files')
      .select(
        'id, original_name, storage_path, mime_type, hinted_role, extracted_word_count',
      )
      .eq('scoring_id', scoringId)
      .eq('category', 'material')
      .order('created_at', { ascending: true });

    if (filesError || !rawFiles || rawFiles.length === 0) {
      throw new AppError(500, '评审材料文件缺失，请重新提交。');
    }

    const storedFiles: StoredScoringFile[] = rawFiles.map((f) => ({
      original_name: f.original_name,
      storage_path: f.storage_path,
      mime_type: f.mime_type,
      hinted_role: f.hinted_role as HintedRole | null,
    }));

    // 2. 确定场景并记录
    const hintedRoles = storedFiles.map((f) => (f.hinted_role || 'unknown') as HintedRole);
    const scenario = detectScenario(hintedRoles);
    await supabaseAdmin
      .from('scorings')
      .update({ scenario, updated_at: new Date().toISOString() })
      .eq('id', scoringId);

    // 3. 准备 OpenAI content parts
    const parts = await prepareScoringMaterialParts(storedFiles, deps.material);

    // 4. 调用 GPT，最多重试一次
    const systemPrompt = buildScoringSystemPrompt();
    const baseUserMessage = buildScoringUserMessage({
      scenario,
      files: storedFiles.map((f) => ({
        filename: f.original_name,
        hintedRole: (f.hinted_role || 'unknown') as HintedRole,
      })),
    });

    let result: ScoringResult | null = null;
    let lastErrors: string[] = [];

    for (let attempt = 1; attempt <= SCORING_JSON_RETRY_MAX_ATTEMPTS; attempt++) {
      const userMessage =
        attempt === 1
          ? baseUserMessage
          : baseUserMessage + buildScoringRetryHint(lastErrors);

      const { text } = await deps.runScoringModel({
        systemPrompt,
        userMessage,
        parts,
      });

      const parsed = parseScoringJson(text);
      if (!parsed) {
        lastErrors = ['response was not valid JSON'];
        if (attempt === SCORING_JSON_RETRY_MAX_ATTEMPTS) {
          throw new AppError(500, '评审结果格式异常，请重新提交。');
        }
        continue;
      }

      const validation = validateScoringJson(parsed);
      if (!validation.ok) {
        lastErrors = validation.errors;
        if (attempt === SCORING_JSON_RETRY_MAX_ATTEMPTS) {
          throw new AppError(500, '评审结果格式异常，请重新提交。');
        }
        continue;
      }

      result = validation.result;
      break;
    }

    if (!result) {
      throw new AppError(500, '评审结果格式异常，请重新提交。');
    }

    // 5. 结算字数（以后端 mammoth/pdf-parse 的 extracted_word_count 为准，不信 GPT 自己数的）
    const fileInfos = rawFiles.map((f) => ({
      originalName: f.original_name,
      extractedWordCount: f.extracted_word_count || 0,
    }));
    const settledWords = computeSettledWords(result, fileInfos, scoring.input_word_count);

    const pricePerWord = await readPricePerWord();
    const actualCost = Math.ceil(settledWords * pricePerWord);
    const costToSettle = Math.min(actualCost, frozenCreditsAmount);

    // 6. 找出 article 文件名作为 PDF 报告标题（去掉扩展名）
    const articleTitle = (() => {
      const articleName = result.detected_files.find((f) => f.role === 'article')?.filename
        || rawFiles[0]?.original_name;
      if (!articleName) return null;
      const lastDot = articleName.lastIndexOf('.');
      return lastDot > 0 ? articleName.slice(0, lastDot) : articleName;
    })();

    // 7. 写 article 角色回到 scoring_files.detected_role
    await updateDetectedRoles(scoringId, rawFiles, result);

    // 8. 渲染 PDF
    const pdfBuffer = await deps.renderPdf(result, scenario, articleTitle);

    // 9. 上传 PDF 到 Storage
    const pdfStoragePath = `scorings/${scoringId}/report-${deps.now()}.pdf`;
    const retentionDays =
      parseInt((await getConfig('result_file_retention_days')) || String(DEFAULT_RESULT_FILE_RETENTION_DAYS), 10)
      || DEFAULT_RESULT_FILE_RETENTION_DAYS;
    const expiresAt = new Date(
      Date.now() + retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { error: pdfUploadError } = await supabaseAdmin.storage
      .from('task-files')
      .upload(pdfStoragePath, pdfBuffer, { contentType: 'application/pdf' });
    if (pdfUploadError) {
      throw new AppError(500, '保存评审报告失败。');
    }

    const reportFileName = articleTitle
      ? `评审报告-${sanitizeForFilename(articleTitle)}.pdf`
      : `评审报告-${new Date().toISOString().slice(0, 10)}.pdf`;

    const { error: fileInsertError } = await supabaseAdmin
      .from('scoring_files')
      .insert({
        scoring_id: scoringId,
        category: 'report',
        original_name: reportFileName,
        storage_path: pdfStoragePath,
        file_size: pdfBuffer.length,
        mime_type: 'application/pdf',
        expires_at: expiresAt,
      });

    if (fileInsertError) {
      await supabaseAdmin.storage.from('task-files').remove([pdfStoragePath]);
      throw new AppError(500, '保存评审报告记录失败。');
    }

    // 10. 更新 scoring 主记录（和 settle 分开写，让"已上传 PDF 但还没改 status"的中间态可被兜底）
    const { error: updateError } = await supabaseAdmin
      .from('scorings')
      .update({
        status: 'completed',
        overall_score: result.overall_score,
        scoring_word_count: settledWords,
        settled_credits: costToSettle,
        result_json: result,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scoringId);

    if (updateError) {
      throw new AppError(500, '更新评审状态失败。');
    }

    // 11. 最后才结算积分（所有副作用稳定落库）
    await settleCredits(userId, costToSettle);
    alreadySettled = true;

    // 12. 退差额（如果有）
    const refundAmount = frozenCreditsAmount - costToSettle;
    if (refundAmount > 0) {
      await refundCredits(userId, refundAmount, 'scoring', scoringId, '评审字数少于冻结的退款');
    }
  } catch (error: unknown) {
    if (frozenCreditsAmount > 0 && !alreadySettled) {
      try {
        await refundCredits(
          userId,
          frozenCreditsAmount,
          'scoring',
          scoringId,
          '评审失败自动退款',
        );
        await supabaseAdmin
          .from('scorings')
          .update({ refunded: true })
          .eq('id', scoringId);
      } catch (refundError) {
        captureError(refundError, 'scoring.refund_failure', { scoringId });
      }
    }

    const failureReason =
      error instanceof AppError
        ? error.userMessage
        : '评审过程中发生错误，请稍后重试。';

    await supabaseAdmin
      .from('scorings')
      .update({
        status: 'failed',
        failure_reason: failureReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scoringId);

    captureError(error, 'scoring.execute_failed', { scoringId });
  }
}

// 把 GPT 的 role 判定回写到 scoring_files.detected_role，便于列表页展示和审计。
async function updateDetectedRoles(
  scoringId: string,
  rawFiles: Array<{ id: string; original_name: string }>,
  result: ScoringResult,
) {
  for (const file of rawFiles) {
    const detected = result.detected_files.find(
      (df) => normalizeFilename(df.filename) === normalizeFilename(file.original_name),
    );
    if (!detected) continue;
    await supabaseAdmin
      .from('scoring_files')
      .update({ detected_role: detected.role })
      .eq('id', file.id);
  }

  // 防止未使用的变量警告（scoringId 未用到，但保留签名以便以后扩展）
  void scoringId;
}

function sanitizeForFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// ---------------------------------------------------------------------------
// 查询接口
// ---------------------------------------------------------------------------

export async function getScoring(scoringId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('scorings')
    .select('*')
    .eq('id', scoringId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new AppError(404, '评审记录不存在。');
  }

  const { data: files } = await supabaseAdmin
    .from('scoring_files')
    .select(
      'id, category, original_name, file_size, mime_type, hinted_role, detected_role, extracted_word_count, created_at, expires_at',
    )
    .eq('scoring_id', scoringId)
    .order('created_at', { ascending: true });

  return { scoring: data, files: files || [] };
}

export async function getScoringCurrent(userId: string) {
  const { data } = await supabaseAdmin
    .from('scorings')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .maybeSingle();

  if (!data) return null;

  const { data: files } = await supabaseAdmin
    .from('scoring_files')
    .select(
      'id, category, original_name, file_size, mime_type, hinted_role, detected_role, extracted_word_count, created_at, expires_at',
    )
    .eq('scoring_id', data.id)
    .order('created_at', { ascending: true });

  return { scoring: data, files: files || [] };
}

export async function getScoringList(userId: string, limit = 20, offset = 0) {
  const { data, error, count } = await supabaseAdmin
    .from('scorings')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new AppError(500, '获取评审记录失败。');
  }

  return { scorings: data || [], total: count || 0 };
}

export async function getScoringDownloadUrl(
  scoringId: string,
  fileId: string,
  userId: string,
) {
  const { data: scoring } = await supabaseAdmin
    .from('scorings')
    .select('user_id')
    .eq('id', scoringId)
    .single();
  if (!scoring || scoring.user_id !== userId) {
    throw new AppError(404, '文件不存在。');
  }

  const { data: file } = await supabaseAdmin
    .from('scoring_files')
    .select('id, storage_path, original_name, expires_at')
    .eq('id', fileId)
    .eq('scoring_id', scoringId)
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

// Expose helper used by tests (without going through the OpenAI call).
export const scoringServiceTestUtils = {
  computeFrozenAmount,
  readPricePerWord,
  computeSettledWords,
  sanitizeForFilename,
  withScoringTimeout,
  ScoringTimeoutError,
  SCORING_STAGE_TIMEOUT_MS,
  SCORING_JSON_RETRY_MAX_ATTEMPTS,
};

// Re-export utility type used by the getFileExtension helper for callers
// that want to keep a single import point.
export { getFileExtension };
