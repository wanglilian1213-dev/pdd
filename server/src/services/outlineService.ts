import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { updateTaskStage, failTask } from './taskService';
import { freezeCredits } from './walletService';
import { getConfig } from './configService';

export async function generateOutline(taskId: string, userId: string) {
  // 读取材料
  const { data: files } = await supabaseAdmin
    .from('task_files')
    .select('original_name, storage_path, mime_type')
    .eq('task_id', taskId)
    .eq('category', 'material');

  if (!files || files.length === 0) {
    await failTask(taskId, 'outline_generating', '没有找到上传的材料文件。', false);
    throw new AppError(400, '没有找到上传的材料文件，请重新创建任务。');
  }

  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('special_requirements')
    .eq('id', taskId)
    .single();

  // 下载并读取材料内容
  const materialTexts: string[] = [];
  for (const file of files) {
    try {
      const { data: fileData } = await supabaseAdmin.storage
        .from('task-files')
        .download(file.storage_path);
      if (fileData) {
        const text = await fileData.text();
        materialTexts.push(`--- ${file.original_name} ---\n${text}`);
      }
    } catch {
      materialTexts.push(`--- ${file.original_name} --- (无法解析)`);
    }
  }

  await updateTaskStage(taskId, 'outline_generating');

  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: [
        {
          role: 'system' as const,
          content: `You are an academic writing assistant. Based on the provided materials, generate a detailed English outline for an academic paper. Also identify:
1. Target word count (default 1000 if unclear)
2. Citation style (default APA 7 if unclear)

Respond in JSON format:
{
  "outline": "the full outline text",
  "target_words": number,
  "citation_style": "string"
}`,
        },
        {
          role: 'user' as const,
          content: `Materials:\n${materialTexts.join('\n\n')}\n\nSpecial requirements: ${task?.special_requirements || 'None'}`,
        },
      ],
    });

    const content = response.output_text;

    let parsed: { outline: string; target_words: number; citation_style: string };
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      parsed = { outline: content, target_words: 1000, citation_style: 'APA 7' };
    }

    const targetWords = parsed.target_words || 1000;
    const citationStyle = parsed.citation_style || 'APA 7';

    const { data: outline, error } = await supabaseAdmin
      .from('outline_versions')
      .insert({
        task_id: taskId,
        version: 1,
        content: parsed.outline,
        target_words: targetWords,
        citation_style: citationStyle,
      })
      .select()
      .single();

    if (error) {
      throw new Error('保存大纲失败');
    }

    await updateTaskStage(taskId, 'outline_ready', {
      target_words: targetWords,
      citation_style: citationStyle,
    });

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'outline_generated',
      detail: { version: 1, target_words: targetWords, citation_style: citationStyle },
    });

    return outline;
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    await failTask(taskId, 'outline_generating', '大纲生成失败，请重新创建任务。AI 返回异常。', false);
    throw new AppError(500, '大纲生成失败，请重新创建任务。');
  }
}

export async function regenerateOutline(taskId: string, userId: string, editInstruction: string) {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) {
    throw new AppError(404, '任务不存在。');
  }
  if (task.stage !== 'outline_ready') {
    throw new AppError(400, '当前阶段无法修改大纲。');
  }

  const maxEdits = (await getConfig('max_outline_edits')) || 4;
  if (task.outline_edits_used >= maxEdits) {
    throw new AppError(400, `大纲修改次数已用完（最多 ${maxEdits} 次）。`);
  }

  const { data: latestOutline } = await supabaseAdmin
    .from('outline_versions')
    .select('*')
    .eq('task_id', taskId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (!latestOutline) {
    throw new AppError(500, '找不到当前大纲。');
  }

  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: [
        {
          role: 'system' as const,
          content: `You are an academic writing assistant. Revise the existing outline based on the user's feedback. Keep the same JSON format:
{
  "outline": "revised outline text",
  "target_words": number,
  "citation_style": "string"
}`,
        },
        {
          role: 'user' as const,
          content: `Current outline:\n${latestOutline.content}\n\nCurrent target words: ${latestOutline.target_words}\nCurrent citation style: ${latestOutline.citation_style}\n\nRevision request: ${editInstruction}`,
        },
      ],
    });

    const content = response.output_text;
    let parsed: { outline: string; target_words: number; citation_style: string };
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      parsed = {
        outline: content,
        target_words: latestOutline.target_words,
        citation_style: latestOutline.citation_style,
      };
    }

    const newVersion = latestOutline.version + 1;

    const { data: outline } = await supabaseAdmin
      .from('outline_versions')
      .insert({
        task_id: taskId,
        version: newVersion,
        content: parsed.outline,
        edit_instruction: editInstruction,
        target_words: parsed.target_words || latestOutline.target_words,
        citation_style: parsed.citation_style || latestOutline.citation_style,
      })
      .select()
      .single();

    await supabaseAdmin
      .from('tasks')
      .update({
        outline_edits_used: task.outline_edits_used + 1,
        target_words: parsed.target_words || latestOutline.target_words,
        citation_style: parsed.citation_style || latestOutline.citation_style,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    return outline;
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, '大纲修改失败，请稍后重试。');
  }
}

export async function confirmOutline(taskId: string, userId: string, targetWords?: number, citationStyle?: string) {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) throw new AppError(404, '任务不存在。');
  if (task.stage !== 'outline_ready') throw new AppError(400, '请先等待大纲生成完成。');

  const { data: latestOutline } = await supabaseAdmin
    .from('outline_versions')
    .select('*')
    .eq('task_id', taskId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (!latestOutline) throw new AppError(500, '找不到大纲。');

  const finalWords = targetWords || latestOutline.target_words || 1000;
  const finalStyle = citationStyle || latestOutline.citation_style || 'APA 7';

  const pricePerThousand = (await getConfig('writing_price_per_1000')) || 250;
  const units = Math.ceil(finalWords / 1000);
  const cost = units * pricePerThousand;

  await freezeCredits(userId, cost, 'task', taskId, `正文生成：${finalWords} 词，${cost} 积分`);

  await supabaseAdmin
    .from('tasks')
    .update({
      stage: 'writing',
      target_words: finalWords,
      citation_style: finalStyle,
      frozen_credits: cost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  await supabaseAdmin.from('task_events').insert({
    task_id: taskId,
    event_type: 'outline_confirmed',
    detail: { target_words: finalWords, citation_style: finalStyle, frozen_credits: cost },
  });

  return { taskId, stage: 'writing', frozenCredits: cost };
}
