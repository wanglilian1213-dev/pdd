import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { updateTaskStage, failTask, completeTask } from './taskService';
import { settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import { Document, Packer, Paragraph, TextRun } from 'docx';

export async function startWritingPipeline(taskId: string, userId: string) {
  try {
    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (!task) throw new Error('Task not found');

    const { data: latestOutline } = await supabaseAdmin
      .from('outline_versions')
      .select('*')
      .eq('task_id', taskId)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (!latestOutline) throw new Error('Outline not found');

    // Step 1: Draft
    await updateTaskStage(taskId, 'writing');
    const draft = await generateDraft(taskId, latestOutline.content, task.target_words, task.citation_style, task.special_requirements);

    // Step 2: Calibrate
    await updateTaskStage(taskId, 'word_calibrating');
    const calibrated = await calibrateWordCount(taskId, draft, task.target_words);

    // Step 3: Citation check
    await updateTaskStage(taskId, 'citation_checking');
    const verified = await verifyCitations(taskId, calibrated, task.citation_style);

    // Step 4: Deliver
    await updateTaskStage(taskId, 'delivering');
    await deliverResults(taskId, userId, verified, task);

    // Success: settle
    await settleCredits(userId, task.frozen_credits);
    await completeTask(taskId);

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'writing_completed',
      detail: { frozen_credits: task.frozen_credits },
    });

  } catch (err: any) {
    console.error(`Writing pipeline failed for task ${taskId}:`, err);

    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('user_id, frozen_credits, stage')
      .eq('id', taskId)
      .single();

    if (task && task.frozen_credits > 0) {
      try {
        await refundCredits(task.user_id, task.frozen_credits, 'task', taskId, `正文生成失败退款：${task.frozen_credits} 积分`);
        await failTask(taskId, task.stage, '正文生成过程中出现问题，积分已自动退回。请重新创建任务。', true);
      } catch (refundErr) {
        console.error(`Refund failed for task ${taskId}:`, refundErr);
        await failTask(taskId, task.stage, '正文生成失败，退款异常，请联系客服处理。', false);
      }
    } else {
      await failTask(taskId, 'writing', '正文生成失败。', false);
    }
  }
}

async function generateDraft(taskId: string, outline: string, targetWords: number, citationStyle: string, requirements: string): Promise<string> {
  const response = await openai.responses.create({
    model: 'gpt-4.1',
    input: [
      {
        role: 'system',
        content: `You are an academic writing expert. Write a complete English academic paper based on the provided outline. Requirements:
- Target word count: approximately ${targetWords} words
- Citation style: ${citationStyle}
- Write only the paper content, no meta-commentary
- Include proper citations and references section`,
      },
      {
        role: 'user',
        content: `Outline:\n${outline}\n\nAdditional requirements: ${requirements || 'None'}`,
      },
    ],
  });

  const content = typeof response.output_text === 'string' ? response.output_text : '';
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: 1,
    stage: 'draft',
    word_count: wordCount,
    content,
  });

  await supabaseAdmin.from('task_events').insert({
    task_id: taskId,
    event_type: 'draft_generated',
    detail: { word_count: wordCount },
  });

  return content;
}

async function calibrateWordCount(taskId: string, draft: string, targetWords: number): Promise<string> {
  const currentWords = draft.split(/\s+/).filter(Boolean).length;
  const tolerance = 0.1;

  if (Math.abs(currentWords - targetWords) / targetWords <= tolerance) {
    await supabaseAdmin.from('document_versions').insert({
      task_id: taskId,
      version: 2,
      stage: 'calibrated',
      word_count: currentWords,
      content: draft,
    });
    return draft;
  }

  const response = await openai.responses.create({
    model: 'gpt-4.1',
    input: [
      {
        role: 'system',
        content: `You are an academic writing editor. The current paper has ${currentWords} words but the target is ${targetWords} words. ${currentWords < targetWords ? 'Expand' : 'Condense'} the paper to approximately ${targetWords} words while maintaining quality and coherence. Output only the revised paper.`,
      },
      {
        role: 'user',
        content: draft,
      },
    ],
  });

  const calibrated = typeof response.output_text === 'string' ? response.output_text : draft;
  const newWordCount = calibrated.split(/\s+/).filter(Boolean).length;

  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: 2,
    stage: 'calibrated',
    word_count: newWordCount,
    content: calibrated,
  });

  return calibrated;
}

async function verifyCitations(taskId: string, text: string, citationStyle: string): Promise<string> {
  const response = await openai.responses.create({
    model: 'gpt-4.1',
    input: [
      {
        role: 'system',
        content: `You are a citation verification expert. Review the paper and ensure all citations follow ${citationStyle} format. Fix any formatting issues. Output the corrected paper text only.`,
      },
      {
        role: 'user',
        content: text,
      },
    ],
  });

  const verified = typeof response.output_text === 'string' ? response.output_text : text;
  const wordCount = verified.split(/\s+/).filter(Boolean).length;

  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: 3,
    stage: 'verified',
    word_count: wordCount,
    content: verified,
  });

  return verified;
}

async function deliverResults(taskId: string, userId: string, finalText: string, task: any) {
  const wordCount = finalText.split(/\s+/).filter(Boolean).length;
  const retentionDays = (await getConfig('result_file_retention_days')) || 3;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + retentionDays);

  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: 4,
    stage: 'final',
    word_count: wordCount,
    content: finalText,
  });

  // Generate .docx
  const doc = new Document({
    sections: [{
      properties: {},
      children: finalText.split('\n').map(line =>
        new Paragraph({
          children: [new TextRun(line)],
        })
      ),
    }],
  });

  const docBuffer = await Packer.toBuffer(doc);
  const docPath = `${taskId}/final-paper.docx`;

  await supabaseAdmin.storage
    .from('task-files')
    .upload(docPath, docBuffer, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

  await supabaseAdmin.from('task_files').insert({
    task_id: taskId,
    category: 'final_doc',
    original_name: 'final-paper.docx',
    storage_path: docPath,
    file_size: docBuffer.length,
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    expires_at: expiresAt.toISOString(),
  });

  // Generate citation report
  const citationReport = await generateCitationReport(finalText, task.citation_style);
  const reportBuffer = Buffer.from(citationReport, 'utf-8');
  const reportPath = `${taskId}/citation-report.txt`;

  await supabaseAdmin.storage
    .from('task-files')
    .upload(reportPath, reportBuffer, { contentType: 'text/plain' });

  await supabaseAdmin.from('task_files').insert({
    task_id: taskId,
    category: 'citation_report',
    original_name: 'citation-report.txt',
    storage_path: reportPath,
    file_size: reportBuffer.length,
    mime_type: 'text/plain',
    expires_at: expiresAt.toISOString(),
  });
}

async function generateCitationReport(text: string, citationStyle: string): Promise<string> {
  const response = await openai.responses.create({
    model: 'gpt-4.1',
    input: [
      {
        role: 'system',
        content: `You are a citation verification expert. Analyze the paper and generate a citation verification report. List each citation found, whether it follows ${citationStyle} format correctly, and any issues. Output as plain text report.`,
      },
      {
        role: 'user',
        content: text,
      },
    ],
  });

  return typeof response.output_text === 'string' ? response.output_text : 'Citation report generation failed.';
}
