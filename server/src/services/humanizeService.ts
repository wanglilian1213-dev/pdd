import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { freezeCredits, settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import { Document, Packer, Paragraph, TextRun } from 'docx';

export async function startHumanize(taskId: string, userId: string) {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) throw new AppError(404, '任务不存在。');
  if (task.status !== 'completed') throw new AppError(400, '只有已完成的任务才能发起降 AI。');

  const { data: pendingJob } = await supabaseAdmin
    .from('humanize_jobs')
    .select('id')
    .eq('task_id', taskId)
    .eq('status', 'processing')
    .single();

  if (pendingJob) throw new AppError(400, '当前已有降 AI 任务在处理中，请等待完成。');

  // Determine input version
  const { data: lastSuccessJob } = await supabaseAdmin
    .from('humanize_jobs')
    .select('id')
    .eq('task_id', taskId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  let inputVersion;
  if (lastSuccessJob) {
    // Use the latest final version (from last humanize)
    const { data: doc } = await supabaseAdmin
      .from('document_versions')
      .select('*')
      .eq('task_id', taskId)
      .eq('stage', 'final')
      .order('version', { ascending: false })
      .limit(1)
      .single();
    inputVersion = doc;
  } else {
    // First time: use original final
    const { data: doc } = await supabaseAdmin
      .from('document_versions')
      .select('*')
      .eq('task_id', taskId)
      .eq('stage', 'final')
      .order('version', { ascending: true })
      .limit(1)
      .single();
    inputVersion = doc;
  }

  if (!inputVersion) throw new AppError(500, '找不到可用的正文版本。');

  const inputWordCount = inputVersion.word_count;
  const pricePerThousand = (await getConfig('humanize_price_per_1000')) || 250;
  const units = Math.ceil(inputWordCount / 1000);
  const cost = units * pricePerThousand;

  const { data: job } = await supabaseAdmin
    .from('humanize_jobs')
    .insert({
      task_id: taskId,
      input_version_id: inputVersion.id,
      input_word_count: inputWordCount,
      frozen_credits: cost,
      status: 'processing',
    })
    .select()
    .single();

  if (!job) throw new AppError(500, '创建降 AI 任务失败。');

  await freezeCredits(userId, cost, 'humanize_job', job.id, `降 AI：${inputWordCount} 词，${cost} 积分`);

  await supabaseAdmin
    .from('tasks')
    .update({ stage: 'humanizing', updated_at: new Date().toISOString() })
    .eq('id', taskId);

  // Async execution
  executeHumanize(taskId, userId, job.id, inputVersion.content, inputWordCount, cost).catch(err => {
    console.error(`Humanize failed for job ${job.id}:`, err);
  });

  return { jobId: job.id, stage: 'humanizing', frozenCredits: cost };
}

async function executeHumanize(taskId: string, userId: string, jobId: string, inputText: string, wordCount: number, frozenCredits: number) {
  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: [
        {
          role: 'system',
          content: `You are a writing humanization expert. Rewrite the following academic paper to reduce AI detection signals while maintaining the same content, arguments, and academic quality. Make the writing style more natural and human-like. Preserve all citations and references. Output only the rewritten paper.`,
        },
        {
          role: 'user',
          content: inputText,
        },
      ],
    });

    const humanized = typeof response.output_text === 'string' ? response.output_text : '';
    const newWordCount = humanized.split(/\s+/).filter(Boolean).length;

    await supabaseAdmin
      .from('document_versions')
      .insert({
        task_id: taskId,
        version: 100 + Math.floor(Date.now() / 1000),
        stage: 'final',
        word_count: newWordCount,
        content: humanized,
      });

    const retentionDays = (await getConfig('result_file_retention_days')) || 3;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + retentionDays);

    const doc = new Document({
      sections: [{
        properties: {},
        children: humanized.split('\n').map(line =>
          new Paragraph({ children: [new TextRun(line)] })
        ),
      }],
    });

    const docBuffer = await Packer.toBuffer(doc);
    const docPath = `${taskId}/humanized-${Date.now()}.docx`;

    await supabaseAdmin.storage
      .from('task-files')
      .upload(docPath, docBuffer, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    await supabaseAdmin.from('task_files').insert({
      task_id: taskId,
      category: 'humanized_doc',
      original_name: 'humanized-paper.docx',
      storage_path: docPath,
      file_size: docBuffer.length,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      expires_at: expiresAt.toISOString(),
    });

    await settleCredits(userId, frozenCredits);
    await supabaseAdmin.from('humanize_jobs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'humanize_completed',
      detail: { job_id: jobId, word_count: newWordCount },
    });

  } catch (err: any) {
    try {
      await refundCredits(userId, frozenCredits, 'humanize_job', jobId, `降 AI 失败退款：${frozenCredits} 积分`);
      await supabaseAdmin.from('humanize_jobs').update({
        status: 'failed',
        failure_reason: '降 AI 处理失败，积分已退回。',
        refunded: true,
      }).eq('id', jobId);
    } catch {
      await supabaseAdmin.from('humanize_jobs').update({
        status: 'failed',
        failure_reason: '降 AI 失败且退款异常，请联系客服。',
        refunded: false,
      }).eq('id', jobId);
    }

    await supabaseAdmin.from('tasks').update({
      stage: 'completed',
      updated_at: new Date().toISOString(),
    }).eq('id', taskId);

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'humanize_failed',
      detail: { job_id: jobId, error: err.message },
    });
  }
}
