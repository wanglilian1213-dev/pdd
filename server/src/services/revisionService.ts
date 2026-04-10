import { supabaseAdmin } from '../lib/supabase';
import { anthropic } from '../lib/anthropic';
import { AppError } from '../lib/errors';
import { freezeCredits, settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import {
  getRevisionMaterialContent,
  SUPPORTED_REVISION_EXTENSIONS,
  getFileExtension,
} from './revisionMaterialService';
import { buildFormattedPaperDocBufferWithMedia } from './documentFormattingService';
import { parseRevisionOutput } from './revisionContentParser';
import { renderCharts, type RenderedChart } from './chartRenderService';
import { captureError } from '../lib/errorMonitor';

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

  // 2. 估算字数并计算冻结金额
  const pricePerK = parseInt(await getConfig('revision_price_per_1000') || '250', 10);
  const estimatedWords = estimateWordCount(files);
  const frozenAmount = computeCost(estimatedWords, pricePerK);

  // 3. 插入 revision 记录（先建单，需要 id 给后续文件路径用）
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
    // 唯一索引冲突说明有并发的进行中修改
    if (insertError?.code === '23505') {
      throw new AppError(400, '您当前有一个正在处理的修改请求，请等待完成后再提交新的修改。');
    }
    throw new AppError(500, '创建修改请求失败。');
  }

  // 4. 冻结积分（独立 try：冻结失败时还没有任何资金动作，直接清理记录即可）
  try {
    await freezeCredits(userId, frozenAmount, 'revision', revision.id, '文章修改冻结积分');
  } catch (freezeError) {
    await supabaseAdmin.from('revisions').delete().eq('id', revision.id);
    throw freezeError;
  }

  // 5. 上传文件 + 启动异步执行（独立 try：失败时必须先 refund 再标记 failed，不能删除记录）
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

    // 3. Call Anthropic API with adaptive extended thinking + max effort
    //    Opus 4.6 推荐写法：thinking.adaptive + output_config.effort=max
    //    （旧写法 thinking.enabled+budget_tokens 已 deprecated）
    //    output_config 是 SDK 类型尚未补齐的新字段，用 spread + as any 透传
    //
    //    系统提示见顶部 REVISION_SYSTEM_PROMPT 常量。
    //    用户消息用结构化模板，把任务/指令/输出要求三段分开，让 Claude 更难跑偏。
    //    max_tokens 提到 80000：旧值 16000 对长论文会被截断；如果上游拒绝再降到 32000。
    const userMessage = `【任务】基于上方提供的原始文档，按以下指令输出修改后的完整论文。

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
    const pricePerK = parseInt(await getConfig('revision_price_per_1000') || '250', 10);
    const actualCost = computeCost(wordCount, pricePerK);
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
