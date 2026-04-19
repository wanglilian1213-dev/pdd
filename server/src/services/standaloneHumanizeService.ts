import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { captureError } from '../lib/errorMonitor';
import { freezeCredits, settleCredits, refundCredits, getBalance } from './walletService';
import { getConfig } from './configService';
import {
  extractFileText,
  defaultScoringMaterialDeps,
  type ScoringMaterialDeps,
  type ExtractedFileInfo,
  type UploadedFileLike,
  countWords,
  getFileExtension,
} from './scoringMaterialService';
import { undetectableClient, type HumanizeTextResult } from '../lib/undetectable';
import { buildFormattedPaperDocBuffer } from './documentFormattingService';
import { recordAuditLog } from './auditLogService';
import {
  splitBodyAndReserved,
  condenseHumanizedBody,
} from './standaloneHumanizeCondenseService';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_HUMANIZE_PRICE_PER_WORD = 0.4;
const DEFAULT_MATERIAL_RETENTION_DAYS = 3;
const DEFAULT_RESULT_FILE_RETENTION_DAYS = 3;

/** 最低字数：短文本降 AI 效果差，且 Undetectable 无下限但实际 <500 效果不稳 */
export const STANDALONE_HUMANIZE_MIN_WORDS = 500;

/** 最高字数：和 Detector 一致的 30,000 上限（避免超出 Undetectable 长度） */
export const STANDALONE_HUMANIZE_MAX_WORDS = 30_000;

// 支持 PDF / DOCX / TXT
const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md']);

// ---------------------------------------------------------------------------
// DI 接口
// ---------------------------------------------------------------------------

export interface StandaloneHumanizeServiceDeps {
  material: ScoringMaterialDeps;
  humanizeText: (text: string) => Promise<HumanizeTextResult>;
  buildDocx: (text: string, options: { paperTitle: string }) => Promise<Buffer>;
  /**
   * 删减膨胀后的正文到目标字数范围。
   * 抛错代表整个删减失败（GPT 调用挂掉等），上层降级交付未删减版。
   */
  condenseBody: (text: string, minWords: number, maxWords: number) => Promise<string>;
  now: () => number;
}

export const defaultStandaloneHumanizeServiceDeps: StandaloneHumanizeServiceDeps = {
  material: defaultScoringMaterialDeps,
  humanizeText: (text) => undetectableClient.humanizeText(text),
  buildDocx: (text, options) => buildFormattedPaperDocBuffer(text, { paperTitle: options.paperTitle }),
  condenseBody: (text, min, max) => condenseHumanizedBody(text, min, max),
  now: () => Date.now(),
};

// ---------------------------------------------------------------------------
// 定价
// ---------------------------------------------------------------------------

async function readPricePerWord(): Promise<number> {
  const raw = await getConfig('humanize_price_per_word');
  if (raw === null || raw === undefined) return DEFAULT_HUMANIZE_PRICE_PER_WORD;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) && num > 0 ? num : DEFAULT_HUMANIZE_PRICE_PER_WORD;
}

function computeFrozenAmount(totalWords: number, pricePerWord: number): number {
  return Math.ceil(totalWords * pricePerWord);
}

// ---------------------------------------------------------------------------
// 文件校验
// ---------------------------------------------------------------------------

export function validateStandaloneHumanizeFiles(files: Express.Multer.File[]) {
  if (!files || files.length === 0) {
    throw new AppError(400, '请上传一个文件。');
  }
  if (files.length > 1) {
    throw new AppError(400, '独立降 AI 一次只能处理一个文件，请分批提交。');
  }

  const file = files[0];
  const ext = getFileExtension(file.originalname);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AppError(
      400,
      `不支持的文件类型：${file.originalname}。只支持 PDF（文字版）、DOCX、TXT。`,
    );
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new AppError(400, `文件 ${file.originalname} 超过 20MB 大小限制。`);
  }
}

// ---------------------------------------------------------------------------
// 材料上传
// ---------------------------------------------------------------------------

async function uploadHumanizeMaterialRaw(
  humanizationId: string,
  file: Express.Multer.File,
  now: () => number,
): Promise<string> {
  const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ext.length > 0 && ext.length <= 8 ? ext : 'bin';
  const storagePath = `standalone-humanizations/${humanizationId}/material-${now()}.${safeExt}`;

  const retentionDays = (await getConfig('material_retention_days')) || DEFAULT_MATERIAL_RETENTION_DAYS;
  const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const { error: uploadError } = await supabaseAdmin.storage
    .from('task-files')
    .upload(storagePath, file.buffer, { contentType: file.mimetype });

  if (uploadError) {
    throw new AppError(500, `文件 ${file.originalname} 上传失败，请稍后重试。`);
  }

  const { error: dbError } = await supabaseAdmin.from('standalone_humanization_files').insert({
    humanization_id: humanizationId,
    category: 'material',
    original_name: file.originalname,
    storage_path: storagePath,
    file_size: file.size,
    mime_type: file.mimetype,
    expires_at: expiresAt,
  });

  if (dbError) {
    await supabaseAdmin.storage.from('task-files').remove([storagePath]);
    throw new AppError(500, '文件记录保存失败。');
  }

  return storagePath;
}

async function cleanupHumanizeMaterials(humanizationId: string): Promise<void> {
  const { data: files } = await supabaseAdmin
    .from('standalone_humanization_files')
    .select('id, storage_path')
    .eq('humanization_id', humanizationId)
    .eq('category', 'material');

  if (!files || files.length === 0) return;

  const paths = files.map((f) => f.storage_path).filter(Boolean) as string[];
  if (paths.length > 0) {
    try {
      await supabaseAdmin.storage.from('task-files').remove(paths);
    } catch (err) {
      captureError(err, 'standalone_humanize.cleanup_storage_failed', { humanizationId });
    }
  }

  try {
    await supabaseAdmin
      .from('standalone_humanization_files')
      .delete()
      .eq('humanization_id', humanizationId)
      .eq('category', 'material');
  } catch (err) {
    captureError(err, 'standalone_humanize.cleanup_db_failed', { humanizationId });
  }
}

async function markInitializingFailed(
  humanizationId: string,
  reason: string,
): Promise<void> {
  await cleanupHumanizeMaterials(humanizationId);
  await supabaseAdmin
    .from('standalone_humanizations')
    .update({
      status: 'failed',
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', humanizationId);
}

// ---------------------------------------------------------------------------
// 预估接口
// ---------------------------------------------------------------------------

export interface EstimateStandaloneHumanizeResult {
  filename: string;
  words: number;
  pricePerWord: number;
  estimatedAmount: number;
  tooShort: boolean;
  tooLong: boolean;
  isScannedPdf: boolean;
  isImage: boolean;
}

export async function estimateStandaloneHumanizeForFile(
  file: Express.Multer.File,
  deps: StandaloneHumanizeServiceDeps = defaultStandaloneHumanizeServiceDeps,
): Promise<EstimateStandaloneHumanizeResult> {
  const ext = getFileExtension(file.originalname);
  const pricePerWord = await readPricePerWord();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      filename: file.originalname,
      words: 0,
      pricePerWord,
      estimatedAmount: 0,
      tooShort: true,
      tooLong: false,
      isScannedPdf: false,
      isImage: ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext),
    };
  }

  const fileLike: UploadedFileLike = {
    originalname: file.originalname,
    buffer: file.buffer,
    mimetype: file.mimetype,
  };

  let extracted: ExtractedFileInfo;
  try {
    extracted = await extractFileText(fileLike, deps.material);
  } catch {
    return {
      filename: file.originalname,
      words: 0,
      pricePerWord,
      estimatedAmount: 0,
      tooShort: true,
      tooLong: false,
      isScannedPdf: false,
      isImage: false,
    };
  }

  const words = extracted.wordCount;
  return {
    filename: extracted.filename,
    words,
    pricePerWord,
    estimatedAmount: words > 0 ? computeFrozenAmount(words, pricePerWord) : 0,
    tooShort: words < STANDALONE_HUMANIZE_MIN_WORDS,
    tooLong: words > STANDALONE_HUMANIZE_MAX_WORDS,
    isScannedPdf: extracted.isScannedPdf,
    isImage: extracted.isImage,
  };
}

// ---------------------------------------------------------------------------
// Core: createStandaloneHumanize（同步快速 → 立即返回）
// ---------------------------------------------------------------------------

export async function createStandaloneHumanize(
  userId: string,
  file: Express.Multer.File,
  deps: StandaloneHumanizeServiceDeps = defaultStandaloneHumanizeServiceDeps,
) {
  // 1. 检查活跃记录
  const { data: active } = await supabaseAdmin
    .from('standalone_humanizations')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', ['initializing', 'processing'])
    .maybeSingle();

  if (active) {
    throw new AppError(
      400,
      '您当前有一个正在处理的降 AI 请求，请等待完成后再提交新的降 AI。',
    );
  }

  // 2. 插入 initializing 记录
  const { data: row, error: insertError } = await supabaseAdmin
    .from('standalone_humanizations')
    .insert({
      user_id: userId,
      status: 'initializing',
      frozen_credits: 0,
      input_word_count: 0,
    })
    .select('*')
    .single();

  if (insertError || !row) {
    if (insertError?.code === '23505') {
      throw new AppError(
        400,
        '您当前有一个正在处理的降 AI 请求，请等待完成后再提交新的降 AI。',
      );
    }
    throw new AppError(500, '创建降 AI 请求失败。');
  }

  // 3. 上传 raw 文件
  try {
    await uploadHumanizeMaterialRaw(row.id, file, deps.now);
  } catch (uploadError) {
    await markInitializingFailed(row.id, '材料上传失败，请稍后重试。');
    throw uploadError;
  }

  // 4. 异步触发 prepareStandaloneHumanize
  prepareStandaloneHumanize(row.id, userId, deps).catch((err) => {
    captureError(err, 'standalone_humanize.prepare', { humanizationId: row.id });
  });

  return row;
}

// ---------------------------------------------------------------------------
// Core: prepareStandaloneHumanize（异步）
// ---------------------------------------------------------------------------

export async function prepareStandaloneHumanize(
  humanizationId: string,
  userId: string,
  deps: StandaloneHumanizeServiceDeps = defaultStandaloneHumanizeServiceDeps,
): Promise<void> {
  // 1. 加载文件
  const { data: storedFile, error: loadError } = await supabaseAdmin
    .from('standalone_humanization_files')
    .select('id, original_name, storage_path, file_size, mime_type')
    .eq('humanization_id', humanizationId)
    .eq('category', 'material')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (loadError || !storedFile) {
    await markInitializingFailed(humanizationId, '加载降 AI 材料失败，请稍后重试。');
    return;
  }

  // 2. 下载 + 解析
  let extracted: ExtractedFileInfo;
  try {
    const blob = await deps.material.downloadFile(storedFile.storage_path);
    const buffer = Buffer.from(await blob.arrayBuffer());
    const fileLike: UploadedFileLike = {
      originalname: storedFile.original_name,
      buffer,
      mimetype: storedFile.mime_type || '',
    };
    extracted = await extractFileText(fileLike, deps.material);
  } catch (extractError) {
    const reason =
      extractError instanceof AppError && extractError.statusCode < 500
        ? extractError.userMessage || '文件解析失败。'
        : '文件解析失败，请检查文件内容。';
    await markInitializingFailed(humanizationId, reason);
    return;
  }

  // 3. 扫描件 / 图片 / 字数校验
  if (extracted.isScannedPdf) {
    await markInitializingFailed(
      humanizationId,
      `扫描件暂不支持降 AI：${extracted.filename}。请上传文字版 PDF 或 DOCX。`,
    );
    return;
  }
  if (extracted.isImage) {
    await markInitializingFailed(humanizationId, '图片不支持降 AI。');
    return;
  }

  const words = extracted.wordCount;
  if (words < STANDALONE_HUMANIZE_MIN_WORDS) {
    await markInitializingFailed(
      humanizationId,
      `文章字数不足：仅 ${words} 词，独立降 AI 至少需要 ${STANDALONE_HUMANIZE_MIN_WORDS} 词。`,
    );
    return;
  }
  if (words > STANDALONE_HUMANIZE_MAX_WORDS) {
    await markInitializingFailed(
      humanizationId,
      `文章字数超出上限：${words} 词超过了 ${STANDALONE_HUMANIZE_MAX_WORDS} 词。请删减后重试。`,
    );
    return;
  }

  const pricePerWord = await readPricePerWord();
  const frozenAmount = computeFrozenAmount(words, pricePerWord);

  // 4. 余额前置校验（友好文案）
  try {
    const wallet = await getBalance(userId);
    if (wallet.balance < frozenAmount) {
      await markInitializingFailed(
        humanizationId,
        `需要 ${frozenAmount} 积分，您当前余额 ${wallet.balance} 积分，请先充值后再操作。`,
      );
      return;
    }
  } catch (balanceError) {
    // 余额查询失败不阻断，交由 freezeCredits 的原子操作兜底
    captureError(balanceError, 'standalone_humanize.balance_check_failed', { humanizationId });
  }

  // 5. 冻结
  try {
    await freezeCredits(
      userId,
      frozenAmount,
      'standalone_humanize',
      humanizationId,
      '独立降 AI 冻结积分',
    );
  } catch (freezeError) {
    const reason =
      freezeError instanceof AppError && freezeError.statusCode < 500
        ? freezeError.userMessage || '积分不足。'
        : '冻结积分失败，请稍后重试。';
    await markInitializingFailed(humanizationId, reason);
    return;
  }

  // 6. 更新状态 + 字数 + 冻结量
  try {
    const { error: updateError } = await supabaseAdmin
      .from('standalone_humanizations')
      .update({
        status: 'processing',
        frozen_credits: frozenAmount,
        input_word_count: words,
        updated_at: new Date().toISOString(),
      })
      .eq('id', humanizationId);

    if (updateError) throw new Error('update standalone_humanizations failed: ' + updateError.message);
  } catch (postFreezeError) {
    try {
      await refundCredits(
        userId,
        frozenAmount,
        'standalone_humanize',
        humanizationId,
        '独立降 AI 准备阶段更新失败自动退款',
      );
    } catch (refundError) {
      captureError(refundError, 'standalone_humanize.prepare_refund_failed', { humanizationId });
    }
    await supabaseAdmin
      .from('standalone_humanizations')
      .update({
        status: 'failed',
        failure_reason: '降 AI 准备失败，积分已自动退回。',
        refunded: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', humanizationId);
    captureError(postFreezeError, 'standalone_humanize.prepare_post_freeze', { humanizationId });
    return;
  }

  // 7. 启动主流程
  executeStandaloneHumanize(
    humanizationId,
    userId,
    extracted.rawText || '',
    storedFile.original_name,
    deps,
  ).catch((err) => {
    captureError(err, 'standalone_humanize.execute', { humanizationId });
  });
}

// ---------------------------------------------------------------------------
// Core: executeStandaloneHumanize（异步）
// ---------------------------------------------------------------------------

function extractArticleTitle(filename: string): string {
  if (!filename) return '降 AI 结果';
  const lastDot = filename.lastIndexOf('.');
  const base = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const trimmed = base.trim();
  return trimmed || '降 AI 结果';
}

export async function executeStandaloneHumanize(
  humanizationId: string,
  userId: string,
  inputText: string,
  originalFilename: string,
  deps: StandaloneHumanizeServiceDeps = defaultStandaloneHumanizeServiceDeps,
): Promise<void> {
  let frozenCreditsAmount = 0;
  let alreadySettled = false;

  try {
    // 1. Load row（拿 frozen_credits）
    const { data: row, error: loadError } = await supabaseAdmin
      .from('standalone_humanizations')
      .select('*')
      .eq('id', humanizationId)
      .single();
    if (loadError || !row) throw new AppError(500, '降 AI 记录不存在。');
    frozenCreditsAmount = row.frozen_credits;

    // 2. 如果上层没传 text（异常路径）从文件重新读
    let text = inputText;
    if (!text || !text.trim()) {
      const { data: fileRow } = await supabaseAdmin
        .from('standalone_humanization_files')
        .select('storage_path, original_name, mime_type')
        .eq('humanization_id', humanizationId)
        .eq('category', 'material')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      if (!fileRow) throw new AppError(500, '降 AI 材料文件缺失。');
      const blob = await deps.material.downloadFile(fileRow.storage_path);
      const buffer = Buffer.from(await blob.arrayBuffer());
      const extracted = await extractFileText(
        {
          originalname: fileRow.original_name,
          buffer,
          mimetype: fileRow.mime_type || '',
        },
        deps.material,
      );
      text = extracted.rawText || '';
    }

    if (!text || text.trim().length === 0) {
      throw new AppError(500, '无法读取文章正文。');
    }

    // 3. 分离正文和保护区（引用/附录）
    //    只把正文送 Undetectable 降 AI，保护区原样保留
    const { body: originalBody, reserved } = splitBodyAndReserved(text);
    const originalBodyWords = countWords(originalBody);

    // 正文过短（<200 词）Undetectable 效果差且可能直接报错，提前失败退款
    if (originalBodyWords < 200) {
      throw new AppError(
        500,
        '文章正文（去除参考文献 / 附录后）字数不足 200 词，无法降 AI。请上传更完整的文档。',
      );
    }

    // 4. 调 Undetectable Humanization（只发正文）
    const { documentId, output } = await deps.humanizeText(originalBody);
    const humanizedBodyRaw = output.trim();
    if (!humanizedBodyRaw) throw new AppError(500, '降 AI 返回空文本。');

    // 5. 字数删减：以原正文字数为基准 ±10%
    const minTargetWords = Math.round(originalBodyWords * 0.9);
    const maxTargetWords = Math.round(originalBodyWords * 1.1);
    const humanizedBodyRawWords = countWords(humanizedBodyRaw);

    let humanizedBody = humanizedBodyRaw;
    if (humanizedBodyRawWords > maxTargetWords) {
      // 只有超出上限才触发删减；低于下限不做处理（Undetectable 膨胀是主要问题）
      try {
        humanizedBody = await deps.condenseBody(humanizedBodyRaw, minTargetWords, maxTargetWords);
      } catch (condenseError) {
        // 降级交付：整次 GPT 调用失败（超时/错误）→ 用未删减版，不让整条任务失败
        // 用户已经付了降 AI 的钱，字数超标但还是能拿到降 AI 后的内容
        captureError(condenseError, 'standalone_humanize.condense_failed', { humanizationId });
        console.warn(
          `[standalone-humanize] condense failed for ${humanizationId}, delivering un-condensed humanized body (${humanizedBodyRawWords} words, target ${minTargetWords}-${maxTargetWords})`,
        );
        humanizedBody = humanizedBodyRaw;
      }
    }

    // 6. 拼回保护区（refs / 附录）
    const humanizedText = reserved
      ? humanizedBody.trimEnd() + '\n\n' + reserved
      : humanizedBody;
    const humanizedWordCount = countWords(humanizedText);

    // 7. 生成 docx
    const articleTitle = extractArticleTitle(originalFilename);
    const docBuffer = await deps.buildDocx(humanizedText, { paperTitle: articleTitle });

    // 5. 上传 docx
    const retentionDays =
      (await getConfig('result_file_retention_days')) || DEFAULT_RESULT_FILE_RETENTION_DAYS;
    const expiresAt = new Date(
      Date.now() + retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const docxPath = `standalone-humanizations/${humanizationId}/humanized-${deps.now()}.docx`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('task-files')
      .upload(docxPath, docBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    if (uploadError) throw new AppError(500, '保存降 AI 文档失败。');

    const { error: fileInsertError } = await supabaseAdmin
      .from('standalone_humanization_files')
      .insert({
        humanization_id: humanizationId,
        category: 'humanized_doc',
        original_name: `${sanitizeForFilename(articleTitle)}-降AI.docx`,
        storage_path: docxPath,
        file_size: docBuffer.length,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        expires_at: expiresAt,
      });
    if (fileInsertError) {
      await supabaseAdmin.storage.from('task-files').remove([docxPath]);
      throw new AppError(500, '保存降 AI 文件记录失败。');
    }

    // 6. 结算
    const pricePerWord = await readPricePerWord();
    const actualCost = Math.ceil(humanizedWordCount * pricePerWord);
    const costToSettle = Math.min(actualCost, frozenCreditsAmount);

    const { error: updateError } = await supabaseAdmin
      .from('standalone_humanizations')
      .update({
        status: 'completed',
        humanized_text: humanizedText,
        humanized_word_count: humanizedWordCount,
        settled_credits: costToSettle,
        undetectable_document_id: documentId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', humanizationId);

    if (updateError) throw new AppError(500, '更新降 AI 状态失败。');

    await settleCredits(userId, costToSettle);
    alreadySettled = true;

    const refundAmount = frozenCreditsAmount - costToSettle;
    if (refundAmount > 0) {
      await refundCredits(
        userId,
        refundAmount,
        'standalone_humanize',
        humanizationId,
        '降 AI 字数差额退款',
      );
    }

    await recordAuditLog({
      actorUserId: userId,
      action: 'standalone_humanize.completed',
      targetType: 'standalone_humanization',
      targetId: humanizationId,
      detail: {
        inputWords: row.input_word_count,
        humanizedWords: humanizedWordCount,
        settledCredits: costToSettle,
        undetectableDocumentId: documentId,
      },
    });
  } catch (error: unknown) {
    if (frozenCreditsAmount > 0 && !alreadySettled) {
      try {
        await refundCredits(
          userId,
          frozenCreditsAmount,
          'standalone_humanize',
          humanizationId,
          '独立降 AI 失败自动退款',
        );
        await supabaseAdmin
          .from('standalone_humanizations')
          .update({ refunded: true })
          .eq('id', humanizationId);
      } catch (refundError) {
        captureError(refundError, 'standalone_humanize.refund_failure', { humanizationId });
      }
    }

    const baseReason =
      error instanceof AppError
        ? error.userMessage
        : '降 AI 过程中发生错误，请稍后重试。';
    const failureReason = frozenCreditsAmount > 0
      ? `${baseReason}${alreadySettled ? '' : '（积分已自动退回）'}`
      : baseReason;

    await supabaseAdmin
      .from('standalone_humanizations')
      .update({
        status: 'failed',
        failure_reason: failureReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', humanizationId);

    captureError(error, 'standalone_humanize.execute_failed', { humanizationId });
  }
}

function sanitizeForFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '降 AI 结果';
}

// ---------------------------------------------------------------------------
// 查询接口
// ---------------------------------------------------------------------------

export async function getStandaloneHumanize(humanizationId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('standalone_humanizations')
    .select('*')
    .eq('id', humanizationId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new AppError(404, '降 AI 记录不存在。');
  }

  const { data: files } = await supabaseAdmin
    .from('standalone_humanization_files')
    .select('id, category, original_name, file_size, mime_type, created_at, expires_at')
    .eq('humanization_id', humanizationId)
    .order('created_at', { ascending: true });

  return { humanization: data, files: files || [] };
}

export async function getStandaloneHumanizeCurrent(userId: string) {
  // 优先返回"正在进行中"；如果没有，再返回最近一条未确认（acknowledged=false）的 completed/failed
  const { data: active } = await supabaseAdmin
    .from('standalone_humanizations')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['initializing', 'processing'])
    .maybeSingle();

  let row = active;
  if (!row) {
    const { data: unack } = await supabaseAdmin
      .from('standalone_humanizations')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['completed', 'failed'])
      .eq('acknowledged', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    row = unack;
  }

  if (!row) return null;

  const { data: files } = await supabaseAdmin
    .from('standalone_humanization_files')
    .select('id, category, original_name, file_size, mime_type, created_at, expires_at')
    .eq('humanization_id', row.id)
    .order('created_at', { ascending: true });

  return { humanization: row, files: files || [] };
}

export async function getStandaloneHumanizeList(userId: string, limit = 20, offset = 0) {
  const { data, error, count } = await supabaseAdmin
    .from('standalone_humanizations')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new AppError(500, '获取降 AI 记录失败。');
  }

  return { humanizations: data || [], total: count || 0 };
}

export async function getStandaloneHumanizeDownloadUrl(
  humanizationId: string,
  fileId: string,
  userId: string,
) {
  const { data: row } = await supabaseAdmin
    .from('standalone_humanizations')
    .select('user_id')
    .eq('id', humanizationId)
    .single();
  if (!row || row.user_id !== userId) {
    throw new AppError(404, '文件不存在。');
  }

  const { data: file } = await supabaseAdmin
    .from('standalone_humanization_files')
    .select('id, storage_path, original_name, expires_at')
    .eq('id', fileId)
    .eq('humanization_id', humanizationId)
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

export async function acknowledgeStandaloneHumanize(humanizationId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('standalone_humanizations')
    .update({ acknowledged: true, updated_at: new Date().toISOString() })
    .eq('id', humanizationId)
    .eq('user_id', userId)
    .select('id')
    .single();
  if (error || !data) {
    throw new AppError(404, '降 AI 记录不存在。');
  }
  return { id: data.id };
}

// ---------------------------------------------------------------------------
// 测试工具
// ---------------------------------------------------------------------------

export const standaloneHumanizeServiceTestUtils = {
  computeFrozenAmount,
  readPricePerWord,
  STANDALONE_HUMANIZE_MIN_WORDS,
  STANDALONE_HUMANIZE_MAX_WORDS,
  extractArticleTitle,
  sanitizeForFilename,
};
