import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { captureError } from '../lib/errorMonitor';
import { freezeCredits, settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import {
  extractFileText,
  defaultScoringMaterialDeps,
  type ScoringMaterialDeps,
  type ExtractedFileInfo,
  type UploadedFileLike,
  SUPPORTED_SCORING_EXTENSIONS,
  getFileExtension,
} from './scoringMaterialService';
import {
  undetectableDetectorClient,
  type DetectAiResult,
  type DetectedSentence,
} from '../lib/undetectableDetector';
import { env } from '../lib/runtimeEnv';
import { recordAuditLog } from './auditLogService';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_AI_DETECTION_PRICE_PER_WORD = 0.05;
const DEFAULT_MATERIAL_RETENTION_DAYS = 3;

/** 最低字数：Undetectable 官方建议 200 词 */
export const AI_DETECTION_MIN_WORDS = 200;

/** 最高字数：Undetectable 请求体硬上限 30,000 词 */
export const AI_DETECTION_MAX_WORDS = 30_000;

// 只支持 PDF / DOCX / TXT（图片不做检测，因为无法提取文字）
const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md']);

// ---------------------------------------------------------------------------
// DI 接口
// ---------------------------------------------------------------------------

export interface AiDetectionServiceDeps {
  material: ScoringMaterialDeps;
  /** 跑 Undetectable Detector 并返回结构化结果 */
  runDetector: (text: string) => Promise<DetectAiResult>;
  now: () => number;
}

export const defaultAiDetectionServiceDeps: AiDetectionServiceDeps = {
  material: defaultScoringMaterialDeps,
  // 2026-04-19 改成走 WebSocket 句子级；如果 UNDETECTABLE_USER_ID 没配会 fallback 到篇章级
  // （不会崩但前端看不到句子标红；在日志里提醒运维）
  runDetector: (text) => {
    if (env.undetectableUserId) {
      return undetectableDetectorClient.detectAiWithSentences(text);
    }
    console.warn(
      '[ai_detection] UNDETECTABLE_USER_ID 未配置，fallback 到篇章级 REST（前端看不到句子标红）',
    );
    return undetectableDetectorClient.detectAi(text);
  },
  now: () => Date.now(),
};

// ---------------------------------------------------------------------------
// 定价辅助
// ---------------------------------------------------------------------------

async function readPricePerWord(): Promise<number> {
  const raw = await getConfig('ai_detection_price_per_word');
  if (raw === null || raw === undefined) return DEFAULT_AI_DETECTION_PRICE_PER_WORD;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) && num > 0 ? num : DEFAULT_AI_DETECTION_PRICE_PER_WORD;
}

function computeFrozenAmount(totalWords: number, pricePerWord: number): number {
  return Math.ceil(totalWords * pricePerWord);
}

// ---------------------------------------------------------------------------
// 文件类型校验（比 scoring 更严：不允许图片）
// ---------------------------------------------------------------------------

export function validateAiDetectionFiles(files: Express.Multer.File[]) {
  if (!files || files.length === 0) {
    throw new AppError(400, '请上传一个文件。');
  }
  if (files.length > 1) {
    throw new AppError(400, 'AI 检测一次只能处理一个文件，请分批提交。');
  }

  const file = files[0];
  const ext = getFileExtension(file.originalname);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AppError(
      400,
      `不支持的文件类型：${file.originalname}。只支持 PDF（文字版）、DOCX、TXT。`,
    );
  }
  if (!SUPPORTED_SCORING_EXTENSIONS.has(ext)) {
    throw new AppError(400, `不支持的文件类型：${file.originalname}。`);
  }
  // 单文件 20MB 上限与项目一致
  if (file.size > 20 * 1024 * 1024) {
    throw new AppError(400, `文件 ${file.originalname} 超过 20MB 大小限制。`);
  }
}

// ---------------------------------------------------------------------------
// 材料上传（raw，不解析）
// ---------------------------------------------------------------------------

async function uploadDetectionMaterialRaw(
  detectionId: string,
  file: Express.Multer.File,
  now: () => number,
): Promise<string> {
  const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ext.length > 0 && ext.length <= 8 ? ext : 'bin';
  const storagePath = `ai-detections/${detectionId}/material-${now()}.${safeExt}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('task-files')
    .upload(storagePath, file.buffer, { contentType: file.mimetype });

  if (uploadError) {
    throw new AppError(500, `文件 ${file.originalname} 上传失败，请稍后重试。`);
  }

  const { error: dbError } = await supabaseAdmin.from('ai_detection_files').insert({
    detection_id: detectionId,
    original_name: file.originalname,
    storage_path: storagePath,
    file_size: file.size,
    mime_type: file.mimetype,
    extracted_word_count: null,
  });

  if (dbError) {
    await supabaseAdmin.storage.from('task-files').remove([storagePath]);
    throw new AppError(500, '文件记录保存失败。');
  }

  return storagePath;
}

async function cleanupDetectionMaterials(detectionId: string): Promise<void> {
  const { data: files } = await supabaseAdmin
    .from('ai_detection_files')
    .select('id, storage_path')
    .eq('detection_id', detectionId);

  if (!files || files.length === 0) return;

  const paths = files.map((f) => f.storage_path).filter(Boolean) as string[];
  if (paths.length > 0) {
    try {
      await supabaseAdmin.storage.from('task-files').remove(paths);
    } catch (err) {
      captureError(err, 'ai_detection.cleanup_storage_failed', { detectionId });
    }
  }

  try {
    await supabaseAdmin.from('ai_detection_files').delete().eq('detection_id', detectionId);
  } catch (err) {
    captureError(err, 'ai_detection.cleanup_db_failed', { detectionId });
  }
}

async function markInitializingFailed(detectionId: string, reason: string): Promise<void> {
  await cleanupDetectionMaterials(detectionId);
  await supabaseAdmin
    .from('ai_detections')
    .update({
      status: 'failed',
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', detectionId);
}

// ---------------------------------------------------------------------------
// 预估接口（前端选文件后显示"预估 N 积分"）
// ---------------------------------------------------------------------------

export interface EstimateAiDetectionResult {
  filename: string;
  words: number;
  pricePerWord: number;
  estimatedAmount: number;
  tooShort: boolean;
  tooLong: boolean;
  isScannedPdf: boolean;
  isImage: boolean;
}

export async function estimateAiDetectionForFile(
  file: Express.Multer.File,
  deps: AiDetectionServiceDeps = defaultAiDetectionServiceDeps,
): Promise<EstimateAiDetectionResult> {
  // 文件类型不在白名单：前端就应该拦掉，但后端兜底
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
  } catch (err) {
    // extractFileText 自己抛 400 的情况（比如 DOCX 空 / PDF 解析超时 / 不支持类型）
    // 统一返回"tooShort"让前端不让提交。具体原因由提交接口再报。
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
    tooShort: words < AI_DETECTION_MIN_WORDS,
    tooLong: words > AI_DETECTION_MAX_WORDS,
    isScannedPdf: extracted.isScannedPdf,
    isImage: extracted.isImage,
  };
}

// ---------------------------------------------------------------------------
// Core: createAiDetection
// ---------------------------------------------------------------------------

export async function createAiDetection(
  userId: string,
  file: Express.Multer.File,
  deps: AiDetectionServiceDeps = defaultAiDetectionServiceDeps,
) {
  // 1. 检查活跃记录
  const { data: active } = await supabaseAdmin
    .from('ai_detections')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', ['initializing', 'processing'])
    .maybeSingle();

  if (active) {
    throw new AppError(
      400,
      '您当前有一个正在处理的检测请求，请等待完成后再提交新的检测。',
    );
  }

  // 2. 插入 initializing 记录
  const { data: detection, error: insertError } = await supabaseAdmin
    .from('ai_detections')
    .insert({
      user_id: userId,
      status: 'initializing',
      frozen_credits: 0,
      input_word_count: 0,
    })
    .select('*')
    .single();

  if (insertError || !detection) {
    if (insertError?.code === '23505') {
      throw new AppError(
        400,
        '您当前有一个正在处理的检测请求，请等待完成后再提交新的检测。',
      );
    }
    throw new AppError(500, '创建检测请求失败。');
  }

  // 3. 上传 raw 文件
  try {
    await uploadDetectionMaterialRaw(detection.id, file, deps.now);
  } catch (uploadError) {
    await markInitializingFailed(detection.id, '材料上传失败，请稍后重试。');
    throw uploadError;
  }

  // 4. 异步触发 prepareAiDetection
  prepareAiDetection(detection.id, userId, deps).catch((err) => {
    captureError(err, 'ai_detection.prepare', { detectionId: detection.id });
  });

  return detection;
}

// ---------------------------------------------------------------------------
// Core: prepareAiDetection（异步）
// ---------------------------------------------------------------------------

export async function prepareAiDetection(
  detectionId: string,
  userId: string,
  deps: AiDetectionServiceDeps = defaultAiDetectionServiceDeps,
): Promise<void> {
  // 1. 加载文件记录
  const { data: storedFile, error: loadError } = await supabaseAdmin
    .from('ai_detection_files')
    .select('id, original_name, storage_path, file_size, mime_type')
    .eq('detection_id', detectionId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (loadError || !storedFile) {
    await markInitializingFailed(detectionId, '加载检测材料失败，请稍后重试。');
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
    await markInitializingFailed(detectionId, reason);
    return;
  }

  // 3. 扫描件 / 图片 / 纯空白都拒
  if (extracted.isScannedPdf) {
    await markInitializingFailed(
      detectionId,
      `扫描件暂不支持 AI 检测：${extracted.filename}。请上传文字版 PDF 或 DOCX。`,
    );
    return;
  }
  if (extracted.isImage) {
    await markInitializingFailed(detectionId, '图片不支持 AI 检测。');
    return;
  }

  const words = extracted.wordCount;
  if (words < AI_DETECTION_MIN_WORDS) {
    await markInitializingFailed(
      detectionId,
      `文章字数不足：仅 ${words} 词，AI 检测至少需要 ${AI_DETECTION_MIN_WORDS} 词。`,
    );
    return;
  }
  if (words > AI_DETECTION_MAX_WORDS) {
    await markInitializingFailed(
      detectionId,
      `文章字数超出上限：${words} 词超过了 ${AI_DETECTION_MAX_WORDS} 词。请删减后重试。`,
    );
    return;
  }

  // 4. 冻结积分
  const pricePerWord = await readPricePerWord();
  const frozenAmount = computeFrozenAmount(words, pricePerWord);

  try {
    await freezeCredits(userId, frozenAmount, 'ai_detection', detectionId, 'AI 检测冻结积分');
  } catch (freezeError) {
    const reason =
      freezeError instanceof AppError && freezeError.statusCode < 500
        ? freezeError.userMessage || '积分不足。'
        : '冻结积分失败，请稍后重试。';
    await markInitializingFailed(detectionId, reason);
    return;
  }

  // 5. 更新状态 + 字数 + 冻结量（失败则退款）
  try {
    const { error: updateError } = await supabaseAdmin
      .from('ai_detections')
      .update({
        status: 'processing',
        frozen_credits: frozenAmount,
        input_word_count: words,
        updated_at: new Date().toISOString(),
      })
      .eq('id', detectionId);

    if (updateError) throw new Error('update ai_detections failed: ' + updateError.message);

    await supabaseAdmin
      .from('ai_detection_files')
      .update({ extracted_word_count: words })
      .eq('id', storedFile.id);
  } catch (postFreezeError) {
    try {
      await refundCredits(
        userId,
        frozenAmount,
        'ai_detection',
        detectionId,
        'AI 检测准备阶段更新失败自动退款',
      );
    } catch (refundError) {
      captureError(refundError, 'ai_detection.prepare_refund_failed', { detectionId });
    }
    await supabaseAdmin
      .from('ai_detections')
      .update({
        status: 'failed',
        failure_reason: 'AI 检测准备失败，积分已自动退回。',
        refunded: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', detectionId);
    captureError(postFreezeError, 'ai_detection.prepare_post_freeze', { detectionId });
    return;
  }

  // 6. 启动主流程
  executeAiDetection(detectionId, userId, extracted.rawText || '', deps).catch((err) => {
    captureError(err, 'ai_detection.execute', { detectionId });
  });
}

// ---------------------------------------------------------------------------
// Core: executeAiDetection（异步）
// ---------------------------------------------------------------------------

export async function executeAiDetection(
  detectionId: string,
  userId: string,
  textToDetect: string,
  deps: AiDetectionServiceDeps = defaultAiDetectionServiceDeps,
): Promise<void> {
  let frozenCreditsAmount = 0;
  let alreadySettled = false;

  try {
    // 1. Load detection record（拿 frozen_credits）
    const { data: detection, error: loadError } = await supabaseAdmin
      .from('ai_detections')
      .select('*')
      .eq('id', detectionId)
      .single();
    if (loadError || !detection) throw new AppError(500, '检测记录不存在。');
    frozenCreditsAmount = detection.frozen_credits;

    // 2. 如果上层没传 rawText（异常路径），从文件重新读
    let text = textToDetect;
    if (!text || !text.trim()) {
      const { data: fileRow } = await supabaseAdmin
        .from('ai_detection_files')
        .select('storage_path, original_name, mime_type')
        .eq('detection_id', detectionId)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      if (!fileRow) throw new AppError(500, '检测材料文件缺失。');
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

    // 3. 调 Undetectable Detector
    const detectResult = await deps.runDetector(text);

    // 4. 结算金额（字数已经确定，差额通常为 0）
    const pricePerWord = await readPricePerWord();
    const actualCost = Math.ceil(detection.input_word_count * pricePerWord);
    const costToSettle = Math.min(actualCost, frozenCreditsAmount);

    // 5. 落库 result_json + overall_score
    const { error: updateError } = await supabaseAdmin
      .from('ai_detections')
      .update({
        status: 'completed',
        overall_score: Math.round(detectResult.overallScore),
        settled_credits: costToSettle,
        result_json: {
          overall_score: detectResult.overallScore,
          result_details: detectResult.resultDetails,
          undetectable_document_id: detectResult.documentId,
          // 句子级结果（走 WebSocket 时有值，走篇章级 fallback 时 undefined）
          // 每项：{ chunk: 句子原文, result: 0-1 浮点 AI 概率, label?: 'Human'|'AI' }
          sentences: detectResult.sentences,
          raw: detectResult.raw,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', detectionId);

    if (updateError) throw new AppError(500, '更新检测状态失败。');

    // 6. 结算（所有副作用稳定后）
    await settleCredits(userId, costToSettle);
    alreadySettled = true;

    // 7. 差额退款（基本为 0，保留对仗）
    const refundAmount = frozenCreditsAmount - costToSettle;
    if (refundAmount > 0) {
      await refundCredits(
        userId,
        refundAmount,
        'ai_detection',
        detectionId,
        'AI 检测字数差额退款',
      );
    }

    await recordAuditLog({
      actorUserId: userId,
      action: 'ai_detection.completed',
      targetType: 'ai_detection',
      targetId: detectionId,
      detail: {
        overallScore: detectResult.overallScore,
        inputWordCount: detection.input_word_count,
        settledCredits: costToSettle,
      },
    });
  } catch (error: unknown) {
    if (frozenCreditsAmount > 0 && !alreadySettled) {
      try {
        await refundCredits(
          userId,
          frozenCreditsAmount,
          'ai_detection',
          detectionId,
          'AI 检测失败自动退款',
        );
        await supabaseAdmin
          .from('ai_detections')
          .update({ refunded: true })
          .eq('id', detectionId);
      } catch (refundError) {
        captureError(refundError, 'ai_detection.refund_failure', { detectionId });
      }
    }

    const failureReason =
      error instanceof AppError
        ? error.userMessage
        : 'AI 检测过程中发生错误，请稍后重试。';

    await supabaseAdmin
      .from('ai_detections')
      .update({
        status: 'failed',
        failure_reason: failureReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', detectionId);

    captureError(error, 'ai_detection.execute_failed', { detectionId });
  }
}

// ---------------------------------------------------------------------------
// 查询接口
// ---------------------------------------------------------------------------

export async function getAiDetection(detectionId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('ai_detections')
    .select('*')
    .eq('id', detectionId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new AppError(404, '检测记录不存在。');
  }

  const { data: files } = await supabaseAdmin
    .from('ai_detection_files')
    .select('id, original_name, file_size, mime_type, extracted_word_count, created_at, expires_at')
    .eq('detection_id', detectionId)
    .order('created_at', { ascending: true });

  return { detection: data, files: files || [] };
}

export async function getAiDetectionCurrent(userId: string) {
  const { data } = await supabaseAdmin
    .from('ai_detections')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['initializing', 'processing'])
    .maybeSingle();

  if (!data) return null;

  const { data: files } = await supabaseAdmin
    .from('ai_detection_files')
    .select('id, original_name, file_size, mime_type, extracted_word_count, created_at, expires_at')
    .eq('detection_id', data.id)
    .order('created_at', { ascending: true });

  return { detection: data, files: files || [] };
}

export async function getAiDetectionList(userId: string, limit = 20, offset = 0) {
  const { data, error, count } = await supabaseAdmin
    .from('ai_detections')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new AppError(500, '获取检测记录失败。');
  }

  return { detections: data || [], total: count || 0 };
}

// ---------------------------------------------------------------------------
// 测试工具
// ---------------------------------------------------------------------------

export const aiDetectionServiceTestUtils = {
  computeFrozenAmount,
  readPricePerWord,
  AI_DETECTION_MIN_WORDS,
  AI_DETECTION_MAX_WORDS,
  DEFAULT_AI_DETECTION_PRICE_PER_WORD,
  DEFAULT_MATERIAL_RETENTION_DAYS,
};
