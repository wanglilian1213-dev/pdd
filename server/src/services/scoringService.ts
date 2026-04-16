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
  hintFileRole,
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
// 上传原始材料到 Storage（不解析字数，只把 raw buffer 写到 Storage + 插 scoring_files 记录）
// 字数提取移到后台 prepareScoring 阶段，避免 HTTP 同步响应里跑 pdf-parse 卡死。
// ---------------------------------------------------------------------------

async function uploadScoringMaterialsRaw(
  scoringId: string,
  files: Express.Multer.File[],
  now: () => number,
): Promise<string[]> {
  const uploadedPaths: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ext.length > 0 && ext.length <= 8 ? ext : 'bin';
    const storagePath = `scorings/${scoringId}/material-${now()}-${i}.${safeExt}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('task-files')
      .upload(storagePath, file.buffer, { contentType: file.mimetype });

    if (uploadError) {
      throw new AppError(500, `文件 ${file.originalname} 上传失败，请稍后重试。`);
    }

    uploadedPaths.push(storagePath);

    // 预判角色（hintFileRole 是同步的、按文件名关键词判断，零延迟）
    // extracted_word_count 暂留 NULL，后台 prepareScoring 阶段再回填。
    const { error: dbError } = await supabaseAdmin.from('scoring_files').insert({
      scoring_id: scoringId,
      category: 'material',
      original_name: file.originalname,
      storage_path: storagePath,
      file_size: file.size,
      mime_type: file.mimetype,
      hinted_role: hintFileRole(file.originalname),
      extracted_word_count: null,
    });

    if (dbError) {
      await supabaseAdmin.storage.from('task-files').remove([storagePath]);
      throw new AppError(500, '文件记录保存失败。');
    }
  }

  return uploadedPaths;
}

// 把已经上传的 Storage 文件 + DB 记录全删掉。用于 initializing 阶段失败的清理。
async function cleanupScoringMaterials(scoringId: string): Promise<void> {
  const { data: files } = await supabaseAdmin
    .from('scoring_files')
    .select('id, storage_path')
    .eq('scoring_id', scoringId)
    .eq('category', 'material');

  if (!files || files.length === 0) return;

  const paths = files.map((f) => f.storage_path).filter(Boolean) as string[];
  if (paths.length > 0) {
    try {
      await supabaseAdmin.storage.from('task-files').remove(paths);
    } catch (err) {
      captureError(err, 'scoring.cleanup_storage_failed', { scoringId });
    }
  }

  try {
    await supabaseAdmin.from('scoring_files').delete().eq('scoring_id', scoringId).eq('category', 'material');
  } catch (err) {
    captureError(err, 'scoring.cleanup_db_failed', { scoringId });
  }
}

// initializing 阶段失败：清理 Storage + DB 记录，标记 failed。不退款（initializing 期间从未冻结过）。
async function markInitializingFailed(
  scoringId: string,
  reason: string,
): Promise<void> {
  await cleanupScoringMaterials(scoringId);
  await supabaseAdmin
    .from('scorings')
    .update({
      status: 'failed',
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', scoringId);
}

// ---------------------------------------------------------------------------
// Core: createScoring（快速创建，不做 extract / freeze）
// ---------------------------------------------------------------------------

export async function createScoring(
  userId: string,
  files: Express.Multer.File[],
  deps: ScoringServiceDeps = defaultScoringServiceDeps,
) {
  // 1. 检查活跃记录（initializing + processing 都算占位）
  const { data: active } = await supabaseAdmin
    .from('scorings')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', ['initializing', 'processing'])
    .maybeSingle();

  if (active) {
    throw new AppError(
      400,
      '您当前有一个正在处理的评审请求，请等待完成后再提交新的评审。',
    );
  }

  // 2. 插入 initializing 记录（不冻结积分；字数和金额都还不知道）
  const { data: scoring, error: insertError } = await supabaseAdmin
    .from('scorings')
    .insert({
      user_id: userId,
      status: 'initializing',
      frozen_credits: 0,
      input_word_count: 0,
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

  // 3. 上传 raw 文件到 Storage（不解析）
  try {
    await uploadScoringMaterialsRaw(scoring.id, files, deps.now);
  } catch (uploadError) {
    // 上传中途失败：清理已上传的文件 + 标记 failed（无 refund，没冻结过）
    await markInitializingFailed(
      scoring.id,
      '材料上传失败，请稍后重试。',
    );
    throw uploadError;
  }

  // 4. 异步触发后台 prepareScoring（pdf-parse + freeze + UPDATE → executeScoring）
  prepareScoring(scoring.id, userId, deps).catch((err) => {
    captureError(err, 'scoring.prepare', { scoringId: scoring.id });
  });

  return scoring;
}

// ---------------------------------------------------------------------------
// Core: prepareScoring（后台阶段：extract → freeze → 状态变 processing → 启动 executeScoring）
// ---------------------------------------------------------------------------

export async function prepareScoring(
  scoringId: string,
  userId: string,
  deps: ScoringServiceDeps = defaultScoringServiceDeps,
): Promise<void> {
  // 1. 加载已上传的 scoring_files 记录
  const { data: storedFiles, error: loadError } = await supabaseAdmin
    .from('scoring_files')
    .select('id, original_name, storage_path, file_size, mime_type')
    .eq('scoring_id', scoringId)
    .eq('category', 'material')
    .order('created_at', { ascending: true });

  if (loadError || !storedFiles || storedFiles.length === 0) {
    await markInitializingFailed(scoringId, '加载评审材料失败，请稍后重试。');
    return;
  }

  // 2. 从 Storage 下载每个文件 → 转成 Multer.File-like 结构传给 extractFileText
  let extracted: ExtractedFileInfo[];
  try {
    const fileLikes = await Promise.all(
      storedFiles.map(async (sf) => {
        const blob = await deps.material.downloadFile(sf.storage_path);
        const buffer = Buffer.from(await blob.arrayBuffer());
        return {
          originalname: sf.original_name,
          buffer,
          mimetype: sf.mime_type || '',
          size: sf.file_size || buffer.length,
        };
      }),
    );

    // 3. 跑 extract（pdf-parse 在 scoringMaterialService 里有 30 秒 timeout 保护）
    //    扫描件 / 纯图片 / 不支持类型在这里抛 AppError(400)
    extracted = await validateAndExtractScoringInputs(fileLikes, deps.material);
  } catch (extractError) {
    const reason =
      extractError instanceof AppError && extractError.statusCode < 500
        ? extractError.userMessage || '材料解析失败。'
        : '材料解析失败，请检查文件内容。';
    await markInitializingFailed(scoringId, reason);
    return;
  }

  // 4. 计算冻结金额
  const pricePerWord = await readPricePerWord();
  const totalWords = extracted.reduce((acc, info) => acc + info.wordCount, 0);
  const frozenAmount = computeFrozenAmount(totalWords, pricePerWord);

  // 5. 冻结积分
  try {
    await freezeCredits(userId, frozenAmount, 'scoring', scoringId, '文章评审冻结积分');
  } catch (freezeError) {
    const reason =
      freezeError instanceof AppError && freezeError.statusCode < 500
        ? freezeError.userMessage || '积分不足。'
        : '冻结积分失败，请稍后重试。';
    await markInitializingFailed(scoringId, reason);
    return;
  }

  // 6. 原子更新 scorings + scoring_files（如果失败，已冻结的积分必须 refund）
  try {
    const { error: updateScoringError } = await supabaseAdmin
      .from('scorings')
      .update({
        status: 'processing',
        frozen_credits: frozenAmount,
        input_word_count: totalWords,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scoringId);

    if (updateScoringError) {
      throw new Error('update scorings failed: ' + updateScoringError.message);
    }

    // 回填每条 scoring_files 的字数（按 storage_path 一一对应）
    for (let i = 0; i < storedFiles.length; i++) {
      const sf = storedFiles[i];
      const info = extracted[i];
      if (!info) continue;
      await supabaseAdmin
        .from('scoring_files')
        .update({
          extracted_word_count: info.wordCount,
          hinted_role: info.hintedRole,
        })
        .eq('id', sf.id);
    }
  } catch (postFreezeError) {
    // freeze 已经成功了但 UPDATE 失败 → 必须 refund
    try {
      await refundCredits(
        userId,
        frozenAmount,
        'scoring',
        scoringId,
        '评审准备阶段更新失败自动退款',
      );
    } catch (refundError) {
      captureError(refundError, 'scoring.prepare_refund_failed', { scoringId });
    }
    await supabaseAdmin
      .from('scorings')
      .update({
        status: 'failed',
        failure_reason: '评审准备失败，积分已自动退回。',
        refunded: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scoringId);
    captureError(postFreezeError, 'scoring.prepare_post_freeze', { scoringId });
    return;
  }

  // 7. 启动 GPT 评审主流程
  executeScoring(scoringId, userId, deps).catch((err) => {
    captureError(err, 'scoring.execute', { scoringId });
  });
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
    .in('status', ['initializing', 'processing'])
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
