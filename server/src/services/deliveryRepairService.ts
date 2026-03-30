import { buildFormattedPaperDocBuffer } from './documentFormattingService';
import { buildDocxFileName, normalizeDeliveryPaperTitle } from './paperTitleService';
import { generateCitationReport, storeGeneratedTaskFile } from './writingService';
import { renderCitationReportPdf } from './citationReportTemplateService';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { getConfig } from './configService';

type GeneratedCategory = 'final_doc' | 'citation_report' | 'humanized_doc';

interface ExistingGeneratedFile {
  id: string;
  category: GeneratedCategory;
  storagePath: string;
  originalName?: string;
}

interface RepairTaskDeliveryDeps {
  loadTaskMeta: (taskId: string) => Promise<{
    id: string;
    title: string;
    citationStyle: string;
    courseCode: string | null;
  } | null>;
  loadDeliveryContent: (taskId: string) => Promise<{
    finalText: string;
    humanizedText: string | null;
  }>;
  listGeneratedFiles: (taskId: string) => Promise<ExistingGeneratedFile[]>;
  removeGeneratedFile: (file: ExistingGeneratedFile) => Promise<void>;
  buildWordBuffer: (text: string, options: { paperTitle: string; courseCode: string | null }) => Promise<Buffer>;
  buildCitationReportData: (text: string, citationStyle: string, essayTitle: string) => Promise<any>;
  buildCitationReportPdf: (reportData: any) => Promise<Buffer>;
  storeGeneratedTaskFile: typeof storeGeneratedTaskFile;
  now: () => Date;
  getRetentionDays: () => Promise<number>;
}

const defaultRepairTaskDeliveryDeps: RepairTaskDeliveryDeps = {
  loadTaskMeta: async (taskId) => {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select('id, title, citation_style, course_code')
      .eq('id', taskId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id as string,
      title: String(data.title || ''),
      citationStyle: String(data.citation_style || 'APA 7'),
      courseCode: data.course_code ? String(data.course_code) : null,
    };
  },
  loadDeliveryContent: async (taskId) => {
    const { data, error } = await supabaseAdmin
      .from('document_versions')
      .select('content, version')
      .eq('task_id', taskId)
      .eq('stage', 'final')
      .order('version', { ascending: true });

    if (error || !data || data.length === 0) {
      throw new AppError(404, '找不到可用于重做交付文件的正文内容。');
    }

    const finalText = String(data[0]?.content || '').trim();
    const humanizedText = data.length > 1 ? String(data[data.length - 1]?.content || '').trim() : null;

    if (!finalText) {
      throw new AppError(400, '原始正文内容为空，无法重做交付文件。');
    }

    return {
      finalText,
      humanizedText: humanizedText || null,
    };
  },
  listGeneratedFiles: async (taskId) => {
    const { data, error } = await supabaseAdmin
      .from('task_files')
      .select('id, category, storage_path, original_name')
      .eq('task_id', taskId)
      .in('category', ['final_doc', 'citation_report', 'humanized_doc']);

    if (error) {
      throw new AppError(500, '读取历史交付文件失败。');
    }

    return (data || []).map((file) => ({
      id: String(file.id),
      category: file.category as GeneratedCategory,
      storagePath: String(file.storage_path),
      originalName: file.original_name ? String(file.original_name) : undefined,
    }));
  },
  removeGeneratedFile: async (file) => {
    await supabaseAdmin.storage.from('task-files').remove([file.storagePath]);
    await supabaseAdmin.from('task_files').delete().eq('id', file.id);
  },
  buildWordBuffer: async (text, options) => buildFormattedPaperDocBuffer(text, options),
  buildCitationReportData: async (text, citationStyle, essayTitle) => generateCitationReport(text, citationStyle, essayTitle),
  buildCitationReportPdf: async (reportData) => renderCitationReportPdf(reportData),
  storeGeneratedTaskFile,
  now: () => new Date(),
  getRetentionDays: async () => (await getConfig('result_file_retention_days')) || 3,
};

function buildExpiryIso(now: Date, retentionDays: number) {
  const expiresAt = new Date(now.getTime());
  expiresAt.setDate(expiresAt.getDate() + retentionDays);
  return expiresAt.toISOString();
}

export async function repairTaskDeliveryFilesWithDeps(
  taskId: string,
  deps: RepairTaskDeliveryDeps,
) {
  const task = await deps.loadTaskMeta(taskId);
  if (!task) {
    throw new AppError(404, '任务不存在。');
  }

  const deliveryContent = await deps.loadDeliveryContent(taskId);
  const existingFiles = await deps.listGeneratedFiles(taskId);
  const existingByCategory = new Map(existingFiles.map((file) => [file.category, file]));
  const displayTitle = normalizeDeliveryPaperTitle(task.title, 'Academic Essay');
  const retentionDays = await deps.getRetentionDays();
  const now = deps.now();
  const expiresAtIso = buildExpiryIso(now, retentionDays);

  for (const file of existingFiles) {
    await deps.removeGeneratedFile(file);
  }

  const docBuffer = await deps.buildWordBuffer(deliveryContent.finalText, {
    paperTitle: displayTitle,
    courseCode: task.courseCode,
  });
  const finalDocName = buildDocxFileName(task.title, 'Academic Essay');

  await deps.storeGeneratedTaskFile({
    taskId,
    category: 'final_doc',
    originalName: finalDocName,
    storagePath: `${taskId}/${finalDocName}`,
    fileSize: docBuffer.length,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    expiresAtIso,
    body: docBuffer,
  });

  const citationReportData = await deps.buildCitationReportData(
    deliveryContent.finalText,
    task.citationStyle,
    displayTitle,
  );
  const reportBuffer = await deps.buildCitationReportPdf(citationReportData);
  await deps.storeGeneratedTaskFile({
    taskId,
    category: 'citation_report',
    originalName: 'citation-report.pdf',
    storagePath: `${taskId}/citation-report.pdf`,
    fileSize: reportBuffer.length,
    mimeType: 'application/pdf',
    expiresAtIso,
    body: reportBuffer,
  });

  if (existingByCategory.has('humanized_doc') && deliveryContent.humanizedText) {
    const existingHumanized = existingByCategory.get('humanized_doc');
    const humanizedBuffer = await deps.buildWordBuffer(deliveryContent.humanizedText, {
      paperTitle: displayTitle,
      courseCode: task.courseCode,
    });

    await deps.storeGeneratedTaskFile({
      taskId,
      category: 'humanized_doc',
      originalName: existingHumanized?.originalName || 'humanized-paper.docx',
      storagePath: `${taskId}/${existingHumanized?.originalName || 'humanized-paper.docx'}`,
      fileSize: humanizedBuffer.length,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      expiresAtIso,
      body: humanizedBuffer,
    });
  }
}

export async function repairTaskDeliveryFiles(taskId: string) {
  return repairTaskDeliveryFilesWithDeps(taskId, defaultRepairTaskDeliveryDeps);
}
