import { supabaseAdmin } from '../lib/supabase';
import { anthropic } from '../lib/anthropic';
import { AppError } from '../lib/errors';
import { freezeCredits, settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import { getRevisionMaterialContent } from './revisionMaterialService';
import { buildFormattedPaperDocBuffer } from './documentFormattingService';
import { captureError } from '../lib/errorMonitor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RevisionStatus = 'processing' | 'completed' | 'failed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateWordCount(files: Express.Multer.File[]): number {
  let total = 0;
  for (const file of files) {
    const ext = file.originalname.toLowerCase().split('.').pop() || '';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'heic', 'heif'].includes(ext)) {
      total += 2000;
    } else if (ext === 'pdf') {
      total += Math.max(500, Math.round(file.size / 6));
    } else {
      total += Math.max(500, Math.round(file.size / 8));
    }
  }
  return total;
}

function computeCost(wordCount: number, pricePerK: number): number {
  return Math.ceil(wordCount / 1000) * pricePerK;
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

// ---------------------------------------------------------------------------
// File upload (for revision_files table)
// ---------------------------------------------------------------------------

async function uploadRevisionFiles(
  revisionId: string,
  files: Express.Multer.File[],
): Promise<void> {
  for (const file of files) {
    const storagePath = `revisions/${revisionId}/${getNow()}-${file.originalname}`;

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
  // 1. Check for active revision
  const { data: active } = await supabaseAdmin
    .from('revisions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .maybeSingle();

  if (active) {
    throw new AppError(400, '您当前有一个正在处理的修改请求，请等待完成后再提交新的修改。');
  }

  // 2. Estimate cost and freeze credits
  const pricePerK = parseInt(await getConfig('revision_price_per_1000') || '250', 10);
  const estimatedWords = estimateWordCount(files);
  const frozenAmount = computeCost(estimatedWords, pricePerK);

  // 3. Insert revision record first (need ID for file paths)
  const { data: revision, error: insertError } = await supabaseAdmin
    .from('revisions')
    .insert({
      user_id: userId,
      instructions,
      status: 'processing',
      frozen_credits: frozenAmount,
    })
    .select('*')
    .single();

  if (insertError || !revision) {
    // Unique index violation means concurrent active revision
    if (insertError?.code === '23505') {
      throw new AppError(400, '您当前有一个正在处理的修改请求，请等待完成后再提交新的修改。');
    }
    throw new AppError(500, '创建修改请求失败。');
  }

  try {
    // 4. Freeze credits
    await freezeCredits(userId, frozenAmount, 'revision', revision.id, '文章修改冻结积分');

    // 5. Upload files
    await uploadRevisionFiles(revision.id, files);

    // 6. Start async execution (non-blocking)
    executeRevision(revision.id, userId).catch((err) => {
      captureError(err, 'revision.execute', { revisionId: revision.id });
    });

    return revision;
  } catch (error) {
    // Cleanup on failure
    await supabaseAdmin.from('revisions').delete().eq('id', revision.id);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Core: execute revision (async background)
// ---------------------------------------------------------------------------

export async function executeRevision(revisionId: string, userId: string) {
  let frozenCreditsAmount = 0;

  try {
    // 1. Load revision
    const { data: revision } = await supabaseAdmin
      .from('revisions')
      .select('*')
      .eq('id', revisionId)
      .single();

    if (!revision) throw new AppError(500, '修改记录不存在。');
    frozenCreditsAmount = revision.frozen_credits;

    // 2. Prepare material content for Claude
    const materialBlocks = await getRevisionMaterialContent(revisionId);

    // 3. Call Anthropic API with extended thinking
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6-20250414',
      max_tokens: 16000,
      thinking: {
        type: 'enabled',
        budget_tokens: 10000,
      },
      messages: [
        {
          role: 'user',
          content: [
            ...materialBlocks,
            {
              type: 'text',
              text: `请根据以下要求修改上述文章：\n\n${revision.instructions}`,
            },
          ],
        },
      ],
    });

    // 4. Extract result text
    const resultText = extractTextFromResponse(response);
    const wordCount = countWords(resultText);

    // 5. Settle credits
    const pricePerK = parseInt(await getConfig('revision_price_per_1000') || '250', 10);
    const actualCost = computeCost(wordCount, pricePerK);
    const costToSettle = Math.min(actualCost, frozenCreditsAmount);

    await settleCredits(userId, costToSettle);

    // Refund excess if frozen > actual
    const refundAmount = frozenCreditsAmount - costToSettle;
    if (refundAmount > 0) {
      await refundCredits(userId, refundAmount, 'revision', revisionId, '修改费用差额退还');
    }

    // 6. Generate Word document
    const docBuffer = await buildFormattedPaperDocBuffer(resultText);
    const docFileName = `修改结果-${new Date().toISOString().slice(0, 10)}.docx`;
    const docStoragePath = `revisions/${revisionId}/${getNow()}-${docFileName}`;

    const retentionDays = parseInt(await getConfig('result_file_retention_days') || '3', 10);
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const { error: uploadError } = await supabaseAdmin.storage
      .from('task-files')
      .upload(docStoragePath, docBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

    if (uploadError) {
      throw new AppError(500, '保存修改结果文件失败。');
    }

    await supabaseAdmin.from('revision_files').insert({
      revision_id: revisionId,
      category: 'revision_output',
      original_name: docFileName,
      storage_path: docStoragePath,
      file_size: docBuffer.length,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      expires_at: expiresAt,
    });

    // 7. Update revision to completed
    await supabaseAdmin
      .from('revisions')
      .update({
        status: 'completed',
        result_text: resultText,
        word_count: wordCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', revisionId);

  } catch (error: unknown) {
    // Refund on failure
    if (frozenCreditsAmount > 0) {
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
