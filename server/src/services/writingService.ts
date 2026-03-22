import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { updateTaskStage, failTask, completeTask } from './taskService';
import { settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import { buildMainOpenAIResponsesOptions } from '../lib/openaiMainConfig';
import { buildFormattedPaperDocBuffer } from './documentFormattingService';
import {
  buildCitationReportPrompt,
  parseCitationReportData,
  renderCitationReportPdf,
} from './citationReportTemplateService';

interface GeneratedTaskFilePayload {
  taskId: string;
  category: 'final_doc' | 'citation_report' | 'humanized_doc';
  originalName: string;
  storagePath: string;
  fileSize: number;
  mimeType: string;
  expiresAtIso: string;
  body: Buffer;
}

interface StoreGeneratedTaskFileDeps {
  uploadToStorage: (
    storagePath: string,
    body: Buffer,
    mimeType: string,
  ) => Promise<{ error: Error | null }>;
  insertTaskFileRecord: (record: {
    task_id: string;
    category: 'final_doc' | 'citation_report' | 'humanized_doc';
    original_name: string;
    storage_path: string;
    file_size: number;
    mime_type: string;
    expires_at: string;
  }) => Promise<{ error: Error | null }>;
  removeFromStorage: (storagePath: string) => Promise<void>;
}

export async function storeGeneratedTaskFile(
  payload: GeneratedTaskFilePayload,
  deps: StoreGeneratedTaskFileDeps = {
    uploadToStorage: async (storagePath, body, mimeType) => {
      const { error } = await supabaseAdmin.storage
        .from('task-files')
        .upload(storagePath, body, { contentType: mimeType });
      return { error: error ? new Error(error.message) : null };
    },
    insertTaskFileRecord: async (record) => {
      const { error } = await supabaseAdmin.from('task_files').insert(record);
      return { error: error ? new Error(error.message) : null };
    },
    removeFromStorage: async (storagePath) => {
      await supabaseAdmin.storage.from('task-files').remove([storagePath]);
    },
  },
) {
  const uploadResult = await deps.uploadToStorage(payload.storagePath, payload.body, payload.mimeType);
  if (uploadResult.error) {
    throw uploadResult.error;
  }

  const insertResult = await deps.insertTaskFileRecord({
    task_id: payload.taskId,
    category: payload.category,
    original_name: payload.originalName,
    storage_path: payload.storagePath,
    file_size: payload.fileSize,
    mime_type: payload.mimeType,
    expires_at: payload.expiresAtIso,
  });

  if (insertResult.error) {
    await deps.removeFromStorage(payload.storagePath).catch(() => undefined);
    throw insertResult.error;
  }
}

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
    ...buildMainOpenAIResponsesOptions('draft_generation'),
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
    ...buildMainOpenAIResponsesOptions('word_calibration'),
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
    ...buildMainOpenAIResponsesOptions('citation_verification'),
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

  const docBuffer = await buildFormattedPaperDocBuffer(finalText);
  const docPath = `${taskId}/final-paper.docx`;

  await storeGeneratedTaskFile({
    taskId,
    category: 'final_doc',
    originalName: 'final-paper.docx',
    storagePath: docPath,
    fileSize: docBuffer.length,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    expiresAtIso: expiresAt.toISOString(),
    body: docBuffer,
  });

  const citationReport = await generateCitationReport(finalText, task.citation_style, task.title || 'Academic Essay');
  const reportBuffer = await renderCitationReportPdf({
    citationStyle: task.citation_style,
    reportId: buildCitationReportId(new Date()),
    generatedAt: new Date().toISOString().slice(0, 10),
    essayTitle: task.title || 'Academic Essay',
    ...citationReport,
  });
  const reportPath = `${taskId}/citation-report.pdf`;

  await storeGeneratedTaskFile({
    taskId,
    category: 'citation_report',
    originalName: 'citation-report.pdf',
    storagePath: reportPath,
    fileSize: reportBuffer.length,
    mimeType: 'application/pdf',
    expiresAtIso: expiresAt.toISOString(),
    body: reportBuffer,
  });
}

function buildCitationReportId(now: Date) {
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `Report ID: V532-${random}-${day}${month}`;
}

async function generateCitationReport(text: string, citationStyle: string, essayTitle: string) {
  const prompt = buildCitationReportPrompt(text, citationStyle);

  // Keep report generation on the same tuning as citation verification until we
  // have a concrete need to split them into separate stages.
  const response = await openai.responses.create({
    ...buildMainOpenAIResponsesOptions('citation_verification'),
    input: [
      {
        role: 'system',
        content: prompt.systemPrompt,
      },
      {
        role: 'user',
        content: `${prompt.userPrompt}\n\nEssay title: ${essayTitle}`,
      },
    ],
  });

  return parseCitationReportData(typeof response.output_text === 'string' ? response.output_text : '', citationStyle);
}
