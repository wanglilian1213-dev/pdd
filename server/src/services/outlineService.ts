import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { updateTaskStage, failTask } from './taskService';
import { getConfig } from './configService';
import { startWritingPipeline } from './writingService';
import { buildMaterialContentFromStorage, cleanupOpenAIFiles } from './materialInputService';
import { confirmOutlineTaskAtomic } from './atomicOpsService';

export function mapOutlineGenerationError(err: unknown) {
  if (err instanceof AppError) {
    return err;
  }

  const detail = err instanceof Error ? err.message : String(err || '');
  const normalized = detail.toLowerCase();

  if (
    normalized.includes('unsupported') ||
    normalized.includes('not supported') ||
    normalized.includes('invalid image') ||
    normalized.includes('does not represent a valid image') ||
    normalized.includes('invalid file') ||
    normalized.includes('failed to parse') ||
    normalized.includes('could not be processed')
  ) {
    return new AppError(
      400,
      'AI 接口暂时无法读取这个材料文件，请换一个常见格式，或先确认文件能正常打开后再试。',
      detail,
    );
  }

  if (
    normalized.includes('too large') ||
    normalized.includes('request too large') ||
    normalized.includes('maximum context') ||
    normalized.includes('context length')
  ) {
    return new AppError(
      400,
      '材料文件太大，AI 接口这次处理不了。请压缩文件，或拆成更小的几个文件后重试。',
      detail,
    );
  }

  if (
    normalized.includes('timed out') ||
    normalized.includes('timeout')
  ) {
    return new AppError(
      500,
      'AI 处理材料超时了，请稍后重试；如果文件很多，建议拆小一点再传。',
      detail,
    );
  }

  return new AppError(500, '大纲生成失败，请稍后重试。', detail);
}

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

  await updateTaskStage(taskId, 'outline_generating');

  let uploadedFileIds: string[] = [];
  try {
    const materialContent = await buildMaterialContentFromStorage(files);
    uploadedFileIds = materialContent.uploadedFileIds;

    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: [
        {
          role: 'system' as const,
          content: `You are an academic writing assistant. Read every attached material file directly. Some files may be documents and some may be images. Based on all provided materials, generate a detailed English outline for an academic paper. Also identify:
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
          content: [
            {
              type: 'input_text',
              text: `请直接阅读我上传的全部材料文件，并据此生成英文论文大纲。特殊要求：${task?.special_requirements || 'None'}`,
            },
            ...materialContent.parts,
          ],
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
    const mappedError = mapOutlineGenerationError(err);
    await failTask(taskId, 'outline_generating', mappedError.userMessage, false);
    throw mappedError;
  } finally {
    await cleanupOpenAIFiles(uploadedFileIds);
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

  const result = await confirmOutlineTaskAtomic(taskId, userId, finalWords, finalStyle, cost);

  // Fire-and-forget: start the writing pipeline asynchronously
  startWritingPipeline(taskId, userId).catch(err => {
    console.error(`Writing pipeline failed for task ${taskId}:`, err);
  });

  return result;
}
