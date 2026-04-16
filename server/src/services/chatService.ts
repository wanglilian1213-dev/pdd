import { supabaseAdmin } from '../lib/supabase';
import { openai, extractOutputText } from '../lib/openai';
import { env } from '../lib/runtimeEnv';
import { getConfig } from './configService';
import { AppError } from '../lib/errors';

// ---------- Rate limiter (in-memory, resets on restart) ----------

const DAILY_LIMIT = 20;

const dailyCounts = new Map<string, { count: number; date: string }>();

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function checkAndIncrementLimit(userId: string): { allowed: boolean; remaining: number } {
  const today = getTodayStr();
  const entry = dailyCounts.get(userId);

  if (!entry || entry.date !== today) {
    dailyCounts.set(userId, { count: 1, date: today });
    return { allowed: true, remaining: DAILY_LIMIT - 1 };
  }

  if (entry.count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: DAILY_LIMIT - entry.count };
}

// ---------- Stage / status translations ----------

function translateStage(stage: string): string {
  const map: Record<string, string> = {
    uploading: '上传中',
    outline_generating: '大纲生成中',
    outline_ready: '大纲已就绪，等待确认',
    outline_regenerating: '大纲修改中',
    writing: '正文写作中',
    word_calibrating: '字数校准中',
    citation_checking: '引用核验中',
    polishing: '润色中',
    delivering: '交付整理中',
    completed: '已完成',
    humanizing: '降 AI 处理中',
  };
  return map[stage] || stage;
}

function translateStatus(status: string): string {
  const map: Record<string, string> = {
    processing: '处理中',
    completed: '已完成',
    failed: '失败',
  };
  return map[status] || status;
}

// ---------- Build user context ----------

export async function buildUserContext(userId: string, userEmail: string): Promise<string> {
  const [walletRes, recentTasksRes, activeTaskRes, recentRevisionsRes, writingPrice] =
    await Promise.all([
      supabaseAdmin
        .from('wallets')
        .select('balance, frozen')
        .eq('user_id', userId)
        .maybeSingle(),
      supabaseAdmin
        .from('tasks')
        .select('id, title, paper_title, stage, status, target_words, failure_reason, created_at, completed_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('tasks')
        .select('id, title, paper_title, stage, status, failure_reason')
        .eq('user_id', userId)
        .eq('status', 'processing')
        .maybeSingle(),
      supabaseAdmin
        .from('revisions')
        .select('id, instructions, status, word_count, failure_reason, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(3),
      getConfig('writing_price_per_word'),
    ]);

  const lines: string[] = [];
  lines.push(`用户邮箱：${userEmail}`);

  if (walletRes.data) {
    lines.push(`积分余额：${walletRes.data.balance}（冻结中：${walletRes.data.frozen}）`);
  } else {
    lines.push('积分余额：未知');
  }

  if (activeTaskRes.data) {
    const t = activeTaskRes.data;
    lines.push(`当前进行中的任务：「${t.paper_title || t.title || '未命名'}」，阶段：${translateStage(t.stage)}，状态：${translateStatus(t.status)}`);
    if (t.failure_reason) lines.push(`  失败原因：${t.failure_reason}`);
  } else {
    lines.push('当前没有进行中的任务。');
  }

  if (recentTasksRes.data && recentTasksRes.data.length > 0) {
    lines.push('最近的任务记录：');
    for (const t of recentTasksRes.data) {
      const name = t.paper_title || t.title || '未命名';
      lines.push(`  - 「${name}」 状态：${translateStatus(t.status)} 阶段：${translateStage(t.stage)} 目标字数：${t.target_words} 创建于：${t.created_at?.slice(0, 10)}`);
    }
  }

  if (recentRevisionsRes.data && recentRevisionsRes.data.length > 0) {
    lines.push('最近的文章修改记录：');
    for (const r of recentRevisionsRes.data) {
      const summary = r.instructions ? r.instructions.slice(0, 60) : '';
      lines.push(`  - 修改指令：「${summary}${r.instructions && r.instructions.length > 60 ? '...' : ''}」 状态：${translateStatus(r.status)} 字数：${r.word_count ?? '处理中'} 创建于：${r.created_at?.slice(0, 10)}`);
    }
  }

  lines.push(`当前正文写作单价：每字 ${writingPrice ?? '未知'} 积分（汉字按字、英文按词；其它功能详细计费规则可引导用户查首页常见问题）`);

  return lines.join('\n');
}

// ---------- System prompt ----------

const SYSTEM_PROMPT_TEMPLATE = `你是"拼代代"平台的智能客服助手。拼代代是一个专业的 AI 英文学术写作工具平台。

平台核心流程：
1. 用户上传任务材料（PDF/DOCX/图片等）
2. 系统自动解析材料并生成英文大纲（可编辑、可重新生成，最多可编辑 4 次）
3. 用户确认大纲后，系统自动生成英文正文
4. 正文完成后自动进行字数校准和引用核验
5. 生成交付文件（Word 文档 + 引用核验报告 PDF）
6. 可选：一键降 AI（humanize），降低 AI 检测率

平台还提供"文章修改"功能：用户上传已有文章 + 修改指令，系统按指令修改并生成新的 Word 文档。

积分与充值：
- 平台使用积分制，用户通过激活码充值
- 写作任务：确认大纲时按目标字数冻结积分，完成后按实际字数结算，差额自动退还
- 文章修改：按修改后的文章字数计费
- 降 AI：按文章字数额外收费
- 如果任务失败，冻结的积分会自动退回

当前用户信息：
---
{userContext}
---

回答规则：
1. 始终使用中文回答
2. 态度友好、专业、简洁
3. 仅回答与拼代代平台相关的问题（功能使用、积分充值、任务状态、文件下载等）
4. 如果用户的问题超出你的能力范围（如需要人工处理的退款、系统 bug 等），引导用户添加人工客服微信：PDDService01
5. 不要编造不存在的功能或虚假承诺
6. 不要泄露任何系统内部实现细节（如 API 结构、数据库表名、AI 模型名称等）
7. 你只是一个客服咨询助手，不能帮用户创建任务、修改密码、充值等操作
8. 如果用户询问的任务或修改记录在上下文数据中能找到，直接引用具体信息回答
9. 对于价格相关问题，告知用户积分价格以平台当前显示为准`;

// ---------- Chat AI call ----------

interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function sendChatMessage(
  userId: string,
  userEmail: string,
  message: string,
  history: ChatHistoryMessage[],
): Promise<{ reply: string; remaining: number }> {
  // 1. Rate limit
  const limit = checkAndIncrementLimit(userId);
  if (!limit.allowed) {
    throw new AppError(429, '今日提问次数已用完（每天 20 条），明天再来吧！');
  }

  // 2. Build user context
  const userContext = await buildUserContext(userId, userEmail);
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{userContext}', userContext);

  // 3. Sanitize history
  const sanitizedHistory: ChatHistoryMessage[] = history
    .slice(-20)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 2000) : '',
    }));

  // 4. Call GPT-5.4
  const response = await openai.responses.create({
    model: env.openaiModel,
    instructions: systemPrompt,
    max_output_tokens: 1024,
    input: [
      ...sanitizedHistory.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: message },
    ],
  } as any);

  const reply = extractOutputText(response) || '抱歉，我暂时无法回答这个问题。请联系人工客服微信：PDDService01';

  return { reply, remaining: limit.remaining };
}
