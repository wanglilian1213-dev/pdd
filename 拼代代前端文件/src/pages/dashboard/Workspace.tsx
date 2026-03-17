import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { UploadCloud, FileText, CheckCircle2, ChevronRight, AlertCircle, Download, Bot, ShieldCheck, RefreshCw, X, Loader2, File } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../lib/api';
import { useBalance } from '../../contexts/BalanceContext';

// ---------------------
// Types
// ---------------------

interface TaskFile {
  id: string;
  category: 'final_doc' | 'citation_report' | 'humanized_doc';
  filename: string;
}

interface Outline {
  id: string;
  content: string;
  target_words?: number;
  citation_style?: string;
}

interface HumanizeJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface Task {
  id: string;
  title: string;
  stage: string;
  status: string;
  failure_reason?: string;
  special_requirements?: string;
}

interface TaskData {
  task: Task;
  outline?: Outline;
  document?: { id: string; word_count?: number };
  files?: TaskFile[];
  humanizeJob?: HumanizeJob;
}

// ---------------------
// Helpers
// ---------------------

/** Map backend stage to UI step number */
function stageToStep(stage: string, status: string): number {
  if (status === 'failed') {
    // Show the step that failed based on stage
    const map: Record<string, number> = {
      uploading: 1, outline_generating: 1, outline_ready: 2,
      writing: 3, word_calibrating: 4, citation_checking: 5,
      delivering: 6, completed: 6, humanizing: 7,
    };
    return map[stage] ?? 1;
  }
  if (status === 'completed' && stage === 'completed') return 6;
  switch (stage) {
    case 'uploading': return 1;
    case 'outline_generating': return 1; // still generating outline, show loading after upload
    case 'outline_ready': return 2;
    case 'writing': return 3;
    case 'word_calibrating': return 4;
    case 'citation_checking': return 5;
    case 'delivering': return 6;
    case 'completed': return 6;
    case 'humanizing': return 7;
    default: return 1;
  }
}

/** Reshape the flat backend task response into the TaskData format expected by the UI */
function reshapeTaskResponse(raw: Record<string, unknown>): TaskData {
  const outlines = raw.outlines as Array<Record<string, unknown>> | undefined;
  const files = raw.files as Array<Record<string, unknown>> | undefined;
  const humanizeJobs = raw.humanizeJobs as Array<Record<string, unknown>> | undefined;
  const latestDocument = raw.latestDocument as Record<string, unknown> | undefined;

  return {
    task: {
      id: raw.id as string,
      title: raw.title as string,
      stage: raw.stage as string,
      status: raw.status as string,
      failure_reason: raw.failure_reason as string | undefined,
      special_requirements: raw.special_requirements as string | undefined,
    },
    outline: outlines && outlines.length > 0
      ? (outlines[outlines.length - 1] as unknown as Outline)
      : undefined,
    document: latestDocument
      ? (latestDocument as unknown as { id: string; word_count?: number })
      : undefined,
    files: files
      ? (files.filter((f) => f.category !== 'material') as unknown as TaskFile[])
      : [],
    humanizeJob: humanizeJobs && humanizeJobs.length > 0
      ? (humanizeJobs[0] as unknown as HumanizeJob)
      : undefined,
  };
}

export default function Workspace() {
  // ---------------------
  // State
  // ---------------------
  const { balance, refreshBalance } = useBalance();
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [specialRequirements, setSpecialRequirements] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPollingOutline, setIsPollingOutline] = useState(false);
  const [isRegeneratingOutline, setIsRegeneratingOutline] = useState(false);
  const [isConfirmingOutline, setIsConfirmingOutline] = useState(false);
  const [isStartingHumanize, setIsStartingHumanize] = useState(false);

  const [taskData, setTaskData] = useState<TaskData | null>(null);
  const [editInstruction, setEditInstruction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [isLoadingResume, setIsLoadingResume] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const outlinePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const writePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const humanizePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------------
  // Cleanup helpers
  // ---------------------
  const clearOutlinePoll = useCallback(() => {
    if (outlinePollRef.current) {
      clearInterval(outlinePollRef.current);
      outlinePollRef.current = null;
    }
  }, []);

  const clearWritePoll = useCallback(() => {
    if (writePollRef.current) {
      clearInterval(writePollRef.current);
      writePollRef.current = null;
    }
  }, []);

  const clearHumanizePoll = useCallback(() => {
    if (humanizePollRef.current) {
      clearInterval(humanizePollRef.current);
      humanizePollRef.current = null;
    }
  }, []);

  const clearAllPolls = useCallback(() => {
    clearOutlinePoll();
    clearWritePoll();
    clearHumanizePoll();
  }, [clearOutlinePoll, clearWritePoll, clearHumanizePoll]);

  // ---------------------
  // Polling: outline generation
  // ---------------------
  const startOutlinePolling = useCallback((taskId: string) => {
    clearOutlinePoll();
    setIsPollingOutline(true);

    outlinePollRef.current = setInterval(async () => {
      try {
        const raw = await api.getTask(taskId);
        const data: TaskData = reshapeTaskResponse(raw);
        setTaskData(data);

        if (data.task.status === 'failed') {
          clearOutlinePoll();
          setIsPollingOutline(false);
          setError(data.task.failure_reason || '大纲生成失败');
          setStep(stageToStep(data.task.stage, data.task.status));
          return;
        }

        if (data.task.stage === 'outline_ready') {
          clearOutlinePoll();
          setIsPollingOutline(false);
          setStep(2);
        }
      } catch (err) {
        clearOutlinePoll();
        setIsPollingOutline(false);
        setError(err instanceof Error ? err.message : '轮询大纲状态失败');
      }
    }, 3000);
  }, [clearOutlinePoll]);

  // ---------------------
  // Polling: writing pipeline
  // ---------------------
  const startWritePolling = useCallback((taskId: string) => {
    clearWritePoll();

    writePollRef.current = setInterval(async () => {
      try {
        const raw = await api.getTask(taskId);
        const data: TaskData = reshapeTaskResponse(raw);
        setTaskData(data);

        if (data.task.status === 'failed') {
          clearWritePoll();
          setError(data.task.failure_reason || '写作流程出错');
          setStep(stageToStep(data.task.stage, data.task.status));
          return;
        }

        const newStep = stageToStep(data.task.stage, data.task.status);
        setStep(newStep);

        // When completed (step 6), stop polling
        if (data.task.stage === 'completed' && data.task.status === 'completed') {
          clearWritePoll();
        }
      } catch (err) {
        clearWritePoll();
        setError(err instanceof Error ? err.message : '轮询写作状态失败');
      }
    }, 5000);
  }, [clearWritePoll]);

  // ---------------------
  // Polling: humanize
  // ---------------------
  const startHumanizePolling = useCallback((taskId: string) => {
    clearHumanizePoll();

    humanizePollRef.current = setInterval(async () => {
      try {
        const raw = await api.getTask(taskId);
        const data: TaskData = reshapeTaskResponse(raw);
        setTaskData(data);

        if (data.task.status === 'failed') {
          clearHumanizePoll();
          setError(data.task.failure_reason || '降AI处理失败');
          return;
        }

        if (data.humanizeJob?.status === 'completed') {
          clearHumanizePoll();
          setIsStartingHumanize(false);
        }
      } catch (err) {
        clearHumanizePoll();
        setIsStartingHumanize(false);
        setError(err instanceof Error ? err.message : '轮询降AI状态失败');
      }
    }, 5000);
  }, [clearHumanizePoll]);

  // ---------------------
  // Resume existing task on mount
  // ---------------------
  useEffect(() => {
    let cancelled = false;

    async function resumeTask() {
      try {
        const raw = await api.getCurrentTask();
        if (cancelled) return;

        if (raw && raw.id) {
          const data: TaskData = reshapeTaskResponse(raw);
          setTaskData(data);
          const resumeStep = stageToStep(data.task.stage, data.task.status);
          setStep(resumeStep);

          if (data.task.status === 'failed') {
            setError(data.task.failure_reason || '任务处理失败');
          } else if (data.task.stage === 'outline_generating' || data.task.stage === 'uploading') {
            startOutlinePolling(data.task.id);
          } else if (['writing', 'word_calibrating', 'citation_checking'].includes(data.task.stage)) {
            startWritePolling(data.task.id);
          } else if (data.task.stage === 'humanizing') {
            setIsStartingHumanize(true);
            startHumanizePolling(data.task.id);
          }
        }
      } catch {
        // No active task, stay at step 1
      } finally {
        if (!cancelled) setIsLoadingResume(false);
      }
    }

    resumeTask();
    refreshBalance();

    return () => {
      cancelled = true;
      clearAllPolls();
    };
  }, [startOutlinePolling, startWritePolling, startHumanizePolling, refreshBalance, clearAllPolls]);

  // ---------------------
  // Handlers
  // ---------------------

  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...newFiles]);
    }
    // Reset input so the same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.docx', '.pdf', '.ppt', '.pptx'];

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      return ACCEPTED_EXTENSIONS.includes(ext);
    });

    if (droppedFiles.length > 0) {
      setFiles(prev => [...prev, ...droppedFiles]);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleCreateTask = useCallback(async () => {
    if (files.length === 0) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const rawTask = await api.createTask(files, title, specialRequirements);
      const data: TaskData = {
        task: { id: rawTask.id, title: rawTask.title, stage: rawTask.stage, status: rawTask.status },
      };
      setTaskData(data);
      // Backend starts outline generation async -- poll for it
      startOutlinePolling(rawTask.id);
      // Show a transitional state: step 1 but polling
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建任务失败');
    } finally {
      setIsSubmitting(false);
    }
  }, [files, title, specialRequirements, startOutlinePolling]);

  const handleRegenerateOutline = useCallback(async () => {
    if (!taskData) return;
    setError(null);
    setIsRegeneratingOutline(true);

    try {
      await api.regenerateOutline(taskData.task.id, editInstruction);
      // The regenerate may return immediately or start async
      // Re-fetch the full task to get updated outline
      const rawUpdated = await api.getTask(taskData.task.id);
      const updated: TaskData = reshapeTaskResponse(rawUpdated);
      setTaskData(updated);

      if (updated.task.stage !== 'outline_ready') {
        // Outline generation is async, poll for it
        startOutlinePolling(updated.task.id);
      }
      setEditInstruction('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新生成大纲失败');
    } finally {
      setIsRegeneratingOutline(false);
    }
  }, [taskData, editInstruction, startOutlinePolling]);

  const handleConfirmOutline = useCallback(async () => {
    if (!taskData) return;
    setError(null);
    setIsConfirmingOutline(true);

    try {
      const data = await api.confirmOutline(
        taskData.task.id,
        taskData.outline?.target_words,
        taskData.outline?.citation_style,
      );
      setTaskData(prev => prev ? { ...prev, task: data.task ?? { ...prev.task, stage: 'writing' } } : prev);
      setStep(3);
      // Start polling for writing pipeline
      startWritePolling(taskData.task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认大纲失败');
    } finally {
      setIsConfirmingOutline(false);
    }
  }, [taskData, startWritePolling]);

  const handleStartHumanize = useCallback(async () => {
    if (!taskData) return;
    setError(null);
    setIsStartingHumanize(true);
    setStep(7);

    try {
      await api.startHumanize(taskData.task.id);
      startHumanizePolling(taskData.task.id);
    } catch (err) {
      setIsStartingHumanize(false);
      setError(err instanceof Error ? err.message : '启动降AI失败');
    }
  }, [taskData, startHumanizePolling]);

  const handleDownload = useCallback(async (fileId: string) => {
    if (!taskData) return;
    setDownloadingFileId(fileId);
    try {
      const data = await api.getDownloadUrl(taskData.task.id, fileId);
      window.open(data.url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取下载链接失败');
    } finally {
      setDownloadingFileId(null);
    }
  }, [taskData]);

  const handleNewTask = useCallback(() => {
    clearAllPolls();
    setStep(1);
    setFiles([]);
    setTitle('');
    setSpecialRequirements('');
    setTaskData(null);
    setEditInstruction('');
    setError(null);
    setIsSubmitting(false);
    setIsPollingOutline(false);
    setIsRegeneratingOutline(false);
    setIsConfirmingOutline(false);
    setIsStartingHumanize(false);
    refreshBalance();
  }, [clearAllPolls, refreshBalance]);

  // ---------------------
  // Derived state
  // ---------------------
  const isHumanizeComplete = taskData?.humanizeJob?.status === 'completed';
  const isHumanizeProcessing = step === 7 && isStartingHumanize && !isHumanizeComplete;

  const finalDocFile = taskData?.files?.find(f => f.category === 'final_doc');
  const citationReportFile = taskData?.files?.find(f => f.category === 'citation_report');
  const humanizedDocFile = taskData?.files?.find(f => f.category === 'humanized_doc');

  const balanceDisplay = balance !== null ? balance.toLocaleString() : '--';

  // Show loading skeleton while checking for active task
  if (isLoadingResume) {
    return (
      <div className="max-w-5xl mx-auto flex items-center justify-center py-32">
        <Loader2 className="w-10 h-10 text-red-700 animate-spin" />
      </div>
    );
  }

  // ---------------------
  // Render
  // ---------------------
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">智能写作工作台</h1>
          <p className="text-sm text-gray-500 mt-1">上传任务材料，系统将为您自动生成高质量文章。</p>
        </div>
        <div className="flex items-center justify-between sm:justify-start gap-2 bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm w-full sm:w-auto">
          <span className="text-sm text-gray-500">当前积分:</span>
          <span className="text-lg font-bold text-red-700">{balanceDisplay}</span>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 text-red-800">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium">出错了</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      {/* Progress Steps */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between min-w-[700px]">
          {[
            { num: 1, label: '上传分析', active: step >= 1 },
            { num: 2, label: '确认大纲', active: step >= 2 },
            { num: 3, label: '正文生成', active: step >= 3 },
            { num: 4, label: '字数矫正', active: step >= 4 },
            { num: 5, label: '引用核验', active: step >= 5 },
            { num: 6, label: '交付核验', active: step >= 6 },
            { num: 7, label: '降低AI', active: step >= 7 },
          ].map((s, i) => (
            <div key={i} className="flex flex-col items-center flex-1 relative">
              <div className={`
                w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm z-10 transition-colors
                ${s.active ? 'bg-red-700 text-white shadow-md' : 'bg-gray-100 text-gray-400'}
              `}>
                {s.active && step > s.num ? <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" /> : s.num}
              </div>
              <span className={`text-xs mt-2 font-medium whitespace-nowrap ${s.active ? 'text-gray-900' : 'text-gray-400'}`}>
                {s.label}
              </span>
              {i < 6 && (
                <div className={`absolute top-4 sm:top-5 left-1/2 w-full h-0.5 -translate-y-1/2 ${step > i + 1 ? 'bg-red-700' : 'bg-gray-100'}`}></div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && !isPollingOutline && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle>上传任务材料</CardTitle>
              <CardDescription>支持 txt, md, docx, pdf, ppt, pptx 格式。可上传多个文件。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div
                className={`border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer group relative ${
                  isDragging
                    ? 'border-red-500 bg-red-50 scale-[1.02]'
                    : 'border-gray-300 hover:bg-gray-50 hover:border-red-300'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  multiple
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".txt,.md,.docx,.pdf,.ppt,.pptx"
                />
                <div className="w-16 h-16 mx-auto bg-red-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <UploadCloud className="w-8 h-8 text-red-700" />
                </div>
                <p className="text-base font-medium text-gray-900 mb-1">点击或拖拽文件到此处上传</p>
                <p className="text-sm text-gray-500">单文件不超过 20MB，最多支持 10 个文件</p>
              </div>

              {files.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-900">已选择文件 ({files.length})</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <File className="w-5 h-5 text-red-600 flex-shrink-0" />
                          <span className="text-sm text-gray-700 truncate">{file.name}</span>
                        </div>
                        <button onClick={() => removeFile(index)} className="text-gray-400 hover:text-red-600 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">特殊要求补充（选填）</label>
                <textarea
                  className="w-full h-32 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-700 focus:border-transparent resize-none"
                  placeholder="例如：请使用 APA 7th 引用格式，字数控制在 2000 字左右，重点分析第三个案例..."
                  value={specialRequirements}
                  onChange={e => setSpecialRequirements(e.target.value)}
                ></textarea>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleCreateTask}
                  className="px-8 shadow-sm"
                  disabled={isSubmitting || files.length === 0}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 w-4 h-4 animate-spin" /> 正在上传并创建任务...
                    </>
                  ) : (
                    <>
                      开始分析并生成大纲 <ChevronRight className="ml-2 w-4 h-4" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Outline generating (polling) */}
      {(isPollingOutline || (step === 1 && taskData && taskData.task.stage === 'outline_generating')) && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="border-gray-200 shadow-sm">
            <CardContent className="p-16 flex flex-col items-center justify-center space-y-6">
              <Loader2 className="w-16 h-16 text-red-700 animate-spin" />
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold text-gray-900">正在解析材料并生成大纲...</h3>
                <p className="text-gray-500">请耐心等待，系统正在分析您的上传材料</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Step 2: Outline */}
      {step === 2 && !isPollingOutline && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="flex flex-row justify-between items-start">
              <div>
                <CardTitle className="text-xl text-red-700 flex items-center gap-2">
                  <FileText className="w-5 h-5" /> 英文大纲已生成
                </CardTitle>
                <CardDescription className="mt-2">
                  请仔细检查大纲结构。确认无误后，系统将基于此大纲生成完整正文。
                </CardDescription>
              </div>
              {taskData?.outline && (
                <div className="text-right text-sm">
                  {taskData.outline.target_words && (
                    <div className="text-gray-500">目标字数: <span className="font-medium text-gray-900">{taskData.outline.target_words.toLocaleString()} words</span></div>
                  )}
                  {taskData.outline.citation_style && (
                    <div className="text-gray-500">引用格式: <span className="font-medium text-gray-900">{taskData.outline.citation_style}</span></div>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 font-mono text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">
                {taskData?.outline?.content || '大纲内容加载中...'}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">对大纲有修改意见？（选填）</label>
                <textarea
                  className="w-full h-24 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-700 focus:border-transparent resize-none"
                  placeholder="例如：请在第三部分增加关于无人机配送的讨论..."
                  value={editInstruction}
                  onChange={e => setEditInstruction(e.target.value)}
                ></textarea>
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-center pt-4 border-t border-gray-100 gap-4">
                <Button variant="outline" onClick={handleNewTask} className="w-full sm:w-auto">返回修改要求</Button>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  <Button
                    variant="secondary"
                    className="bg-gray-100 text-gray-700 hover:bg-gray-200 w-full sm:w-auto"
                    onClick={handleRegenerateOutline}
                    disabled={isRegeneratingOutline}
                  >
                    {isRegeneratingOutline ? (
                      <><Loader2 className="mr-2 w-4 h-4 animate-spin" /> 重新生成中...</>
                    ) : (
                      '重新生成大纲'
                    )}
                  </Button>
                  <Button
                    onClick={handleConfirmOutline}
                    className="shadow-sm w-full sm:w-auto"
                    disabled={isConfirmingOutline}
                  >
                    {isConfirmingOutline ? (
                      <><Loader2 className="mr-2 w-4 h-4 animate-spin" /> 确认中...</>
                    ) : (
                      '确认大纲，开始生成'
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Steps 3, 4, 5: Processing */}
      {step >= 3 && step <= 5 && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="border-gray-200 shadow-sm">
            <CardContent className="p-16 flex flex-col items-center justify-center space-y-6">
              <Loader2 className="w-16 h-16 text-red-700 animate-spin" />
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold text-gray-900">
                  {step === 3 && '正在生成正文...'}
                  {step === 4 && '正在进行字数矫正...'}
                  {step === 5 && '正在进行引用核验...'}
                </h3>
                <p className="text-gray-500">请耐心等待，系统正在调用 Academic-RLHF™ 引擎处理中</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Step 6: Delivery */}
      {step === 6 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-gray-200 shadow-sm border-t-4 border-t-emerald-500">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-emerald-100 p-2 rounded-full">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
                <CardTitle className="text-2xl">交付核验完成</CardTitle>
              </div>
              <CardDescription>您的文章已生成完毕，并已通过引用核验。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Final Document */}
                <div className="border border-gray-200 rounded-xl p-6 flex flex-col items-center text-center hover:border-red-300 transition-colors bg-white shadow-sm">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">最终版文章</h3>
                  <p className="text-xs text-gray-500 mb-6">
                    {finalDocFile ? finalDocFile.filename : 'Word 格式 (.docx)'}
                    {taskData?.document?.word_count ? ` • ${taskData.document.word_count.toLocaleString()} words` : ''}
                  </p>
                  <Button
                    className="w-full gap-2"
                    variant="outline"
                    disabled={!finalDocFile || downloadingFileId === finalDocFile?.id}
                    onClick={() => finalDocFile && handleDownload(finalDocFile.id)}
                  >
                    {downloadingFileId === finalDocFile?.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    下载文档
                  </Button>
                </div>

                {/* Verification Report */}
                <div className="border border-gray-200 rounded-xl p-6 flex flex-col items-center text-center hover:border-red-300 transition-colors bg-white shadow-sm">
                  <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mb-4">
                    <ShieldCheck className="w-8 h-8" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">引用核验报告</h3>
                  <p className="text-xs text-gray-500 mb-6">
                    {citationReportFile ? citationReportFile.filename : 'PDF 格式 (.pdf)'}
                  </p>
                  <Button
                    className="w-full gap-2"
                    variant="outline"
                    disabled={!citationReportFile || downloadingFileId === citationReportFile?.id}
                    onClick={() => citationReportFile && handleDownload(citationReportFile.id)}
                  >
                    {downloadingFileId === citationReportFile?.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    下载报告
                  </Button>
                </div>
              </div>

              {/* AI Reduction Section */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2">
                  <Bot className="w-5 h-5 text-red-700" /> 觉得 AI 痕迹过重？
                </h3>
                <p className="text-sm text-gray-600 mb-6">
                  您可以使用自动降AI功能，系统将重写部分文本结构以降低检测率。
                </p>

                <div className="flex flex-col sm:flex-row gap-4">
                  <Button className="flex-1 gap-2 shadow-sm" onClick={handleStartHumanize}>
                    <RefreshCw className="w-4 h-4" /> 开始自动降AI
                  </Button>
                  <Button variant="secondary" className="flex-1 gap-2 bg-white border border-gray-200">
                    人工降AI请联系客服
                  </Button>
                </div>
              </div>

              <div className="flex justify-center pt-4">
                <Button variant="link" onClick={handleNewTask} className="text-gray-500 hover:text-gray-900">
                  创建新任务
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Step 7: Reduce AI */}
      {step === 7 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-gray-200 shadow-sm border-t-4 border-t-blue-500">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-blue-100 p-2 rounded-full">
                  <Bot className="w-6 h-6 text-blue-600" />
                </div>
                <CardTitle className="text-2xl">AI 降重处理</CardTitle>
              </div>
              <CardDescription>系统正在使用对抗网络降低文本的 AI 生成特征。</CardDescription>
            </CardHeader>
            <CardContent>
              {isHumanizeProcessing ? (
                <div className="p-12 flex flex-col items-center justify-center space-y-6">
                  <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />
                  <div className="text-center space-y-2">
                    <h3 className="text-xl font-bold text-gray-900">正在进行深度 AI 降重...</h3>
                    <p className="text-gray-500">预计需要 1-2 分钟，请勿关闭页面</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-8 animate-in fade-in zoom-in duration-500">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3 text-emerald-800">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                    <div>
                      <p className="font-bold">降重完成！</p>
                      <p className="text-sm">AI 特征已显著降低，请下载最新版本。</p>
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-xl p-6 flex flex-col items-center text-center hover:border-blue-300 transition-colors bg-white shadow-sm max-w-md mx-auto">
                    <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
                      <FileText className="w-8 h-8" />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1">降重版文章</h3>
                    <p className="text-xs text-gray-500 mb-6">
                      {humanizedDocFile ? humanizedDocFile.filename : 'Word 格式 (.docx)'}
                    </p>
                    <Button
                      className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                      disabled={!humanizedDocFile || downloadingFileId === humanizedDocFile?.id}
                      onClick={() => humanizedDocFile && handleDownload(humanizedDocFile.id)}
                    >
                      {downloadingFileId === humanizedDocFile?.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      下载降重版
                    </Button>
                  </div>

                  <div className="flex justify-center pt-4 border-t border-gray-100">
                    <Button variant="link" onClick={handleNewTask} className="text-gray-500 hover:text-gray-900">
                      完成并创建新任务
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
