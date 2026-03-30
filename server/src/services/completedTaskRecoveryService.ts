import { AppError } from '../lib/errors';
import { supabaseAdmin } from '../lib/supabase';
import { repairTaskDeliveryFiles } from './deliveryRepairService';
import { ensureUsableOutlineForTask, type UsableOutlineResult } from './outlineService';
import { type StoredMaterialFile } from './materialInputService';
import { regenerateDeliverableContent } from './writingService';
import { assessGeneratedPaper } from './paperQualityService';

interface RecoveryTaskMeta {
  id: string;
  title: string;
  paperTitle: string | null;
  researchQuestion: string | null;
  specialRequirements: string;
  targetWords: number;
  citationStyle: string;
  courseCode: string | null;
  status: string;
  stage: string;
}

interface RecoveryDeps {
  loadTask: (taskId: string) => Promise<RecoveryTaskMeta | null>;
  loadLatestOutline: (taskId: string) => Promise<{
    id: string;
    version: number;
    content: string;
    paperTitle: string | null;
    researchQuestion: string | null;
    targetWords: number;
    citationStyle: string;
  } | null>;
  loadMaterialFiles: (taskId: string) => Promise<StoredMaterialFile[]>;
  loadCurrentDeliveryContent: (taskId: string) => Promise<{
    finalText: string;
    humanizedText: string | null;
  }>;
  ensureUsableOutline: (
    task: RecoveryTaskMeta,
    latestOutline: NonNullable<Awaited<ReturnType<RecoveryDeps['loadLatestOutline']>>>,
    materialFiles: StoredMaterialFile[],
  ) => Promise<UsableOutlineResult>;
  regenerateDeliveryContent: (payload: {
    taskId: string;
    materialFiles: StoredMaterialFile[];
    outlineContent: string;
    paperTitle: string;
    researchQuestion: string;
    targetWords: number;
    citationStyle: string;
    requirements: string;
    courseCode: string | null;
  }) => Promise<string>;
  syncTaskMetadata: (taskId: string, payload: {
    paperTitle: string;
    researchQuestion: string;
    targetWords: number;
    citationStyle: string;
    courseCode: string | null;
  }) => Promise<void>;
  rebuildDeliveryFiles: (taskId: string, options: {
    finalText: string;
    preserveHumanizedDoc: boolean;
  }) => Promise<void>;
}

const defaultRecoveryDeps: RecoveryDeps = {
  loadTask: async (taskId) => {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select('id, title, paper_title, research_question, special_requirements, target_words, citation_style, course_code, status, stage')
      .eq('id', taskId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: String(data.id),
      title: String(data.title || ''),
      paperTitle: data.paper_title ? String(data.paper_title) : null,
      researchQuestion: data.research_question ? String(data.research_question) : null,
      specialRequirements: String(data.special_requirements || ''),
      targetWords: Number(data.target_words || 1000),
      citationStyle: String(data.citation_style || 'APA 7'),
      courseCode: data.course_code ? String(data.course_code) : null,
      status: String(data.status || ''),
      stage: String(data.stage || ''),
    };
  },
  loadLatestOutline: async (taskId) => {
    const { data, error } = await supabaseAdmin
      .from('outline_versions')
      .select('id, version, content, paper_title, research_question, target_words, citation_style')
      .eq('task_id', taskId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      id: String(data.id),
      version: Number(data.version || 1),
      content: String(data.content || ''),
      paperTitle: data.paper_title ? String(data.paper_title) : null,
      researchQuestion: data.research_question ? String(data.research_question) : null,
      targetWords: Number(data.target_words || 1000),
      citationStyle: String(data.citation_style || 'APA 7'),
    };
  },
  loadMaterialFiles: async (taskId) => {
    const { data, error } = await supabaseAdmin
      .from('task_files')
      .select('original_name, storage_path, mime_type')
      .eq('task_id', taskId)
      .eq('category', 'material');

    if (error) {
      throw new AppError(500, '读取任务材料失败。');
    }

    return (data || []) as StoredMaterialFile[];
  },
  loadCurrentDeliveryContent: async (taskId) => {
    const { data: latestVerified, error: verifiedError } = await supabaseAdmin
      .from('document_versions')
      .select('content')
      .eq('task_id', taskId)
      .eq('stage', 'verified')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: latestFinal, error: finalError } = await supabaseAdmin
      .from('document_versions')
      .select('content')
      .eq('task_id', taskId)
      .eq('stage', 'final')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (verifiedError || finalError) {
      throw new AppError(500, '读取当前正文失败。');
    }

    return {
      finalText: String(latestVerified?.content || latestFinal?.content || ''),
      humanizedText: null,
    };
  },
  ensureUsableOutline: async (task, latestOutline) => {
    void task;
    void latestOutline;
    return ensureUsableOutlineForTask(task.id);
  },
  regenerateDeliveryContent: async (payload) => regenerateDeliverableContent({
    taskId: payload.taskId,
    materialFiles: payload.materialFiles,
    outline: payload.outlineContent,
    paperTitle: payload.paperTitle,
    researchQuestion: payload.researchQuestion,
    targetWords: payload.targetWords,
    citationStyle: payload.citationStyle,
    requirements: payload.requirements,
    courseCode: payload.courseCode,
  }),
  syncTaskMetadata: async (taskId, payload) => {
    const { error } = await supabaseAdmin
      .from('tasks')
      .update({
        paper_title: payload.paperTitle,
        research_question: payload.researchQuestion,
        target_words: payload.targetWords,
        citation_style: payload.citationStyle,
        course_code: payload.courseCode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    if (error) {
      throw new AppError(500, '同步任务元信息失败。');
    }
  },
  rebuildDeliveryFiles: async (taskId, options) => {
    await repairTaskDeliveryFiles(taskId, {
      finalTextOverride: options.finalText,
      preserveHumanizedDoc: options.preserveHumanizedDoc,
    });
  },
};

function titleNeedsRepair(task: RecoveryTaskMeta, outline: UsableOutlineResult) {
  const current = String(task.paperTitle || '').trim();
  return !current || current !== outline.paperTitle;
}

export async function remediateCompletedTaskWithDeps(taskId: string, deps: RecoveryDeps) {
  const task = await deps.loadTask(taskId);
  if (!task) {
    throw new AppError(404, '任务不存在。');
  }

  if (task.status !== 'completed') {
    throw new AppError(400, '只支持修复已完成任务。');
  }

  const latestOutline = await deps.loadLatestOutline(taskId);
  if (!latestOutline) {
    throw new AppError(404, '找不到已确认的大纲。');
  }

  const materialFiles = await deps.loadMaterialFiles(taskId);
  const usableOutline = await deps.ensureUsableOutline(task, latestOutline, materialFiles);
  const currentDelivery = await deps.loadCurrentDeliveryContent(taskId);
  const contentAssessment = assessGeneratedPaper(currentDelivery.finalText);
  const needsContentRecovery = !contentAssessment.valid;

  let finalText = currentDelivery.finalText;
  if (needsContentRecovery) {
    finalText = await deps.regenerateDeliveryContent({
      taskId,
      materialFiles,
      outlineContent: usableOutline.outlineContent,
      paperTitle: usableOutline.paperTitle,
      researchQuestion: usableOutline.researchQuestion,
      targetWords: usableOutline.targetWords,
      citationStyle: usableOutline.citationStyle,
      requirements: task.specialRequirements,
      courseCode: usableOutline.courseCode,
    });
  }

  await deps.syncTaskMetadata(taskId, {
    paperTitle: usableOutline.paperTitle,
    researchQuestion: usableOutline.researchQuestion,
    targetWords: usableOutline.targetWords,
    citationStyle: usableOutline.citationStyle,
    courseCode: usableOutline.courseCode,
  });

  await deps.rebuildDeliveryFiles(taskId, {
    finalText,
    preserveHumanizedDoc: !needsContentRecovery,
  });

  return {
    repairedTitleOnly: !needsContentRecovery && titleNeedsRepair(task, usableOutline),
    repairedContent: needsContentRecovery,
    paperTitle: usableOutline.paperTitle,
  };
}

export async function remediateCompletedTask(taskId: string) {
  return remediateCompletedTaskWithDeps(taskId, defaultRecoveryDeps);
}
