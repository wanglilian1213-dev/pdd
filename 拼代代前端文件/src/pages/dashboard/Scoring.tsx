import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UploadCloud,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  X,
  File,
  RefreshCw,
  Gauge,
} from 'lucide-react';
import { api } from '../../lib/api';
import { triggerDownload } from '../../lib/downloadFile';
import { useBalance } from '../../contexts/BalanceContext';

// ---------------------------------------------------------------------------
// Types — mirror server response shapes from scoringService / scoringPromptService
// ---------------------------------------------------------------------------

interface ScoringDimension {
  name: string;
  weight: number;
  score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

interface DetectedFile {
  filename: string;
  role: 'article' | 'rubric' | 'brief' | 'other';
  note: string;
}

interface ScoringResult {
  overall_score: number;
  overall_comment: string;
  dimensions: ScoringDimension[];
  top_suggestions: string[];
  detected_files: DetectedFile[];
}

interface ScoringFile {
  id: string;
  category: 'material' | 'report';
  original_name: string;
  file_size: number;
  mime_type: string;
  created_at: string;
  expires_at: string | null;
}

interface ScoringData {
  scoring: {
    id: string;
    status: 'initializing' | 'processing' | 'completed' | 'failed';
    scenario: 'rubric' | 'brief_only' | 'article_only' | null;
    overall_score: number | null;
    scoring_word_count: number | null;
    input_word_count: number;
    frozen_credits: number;
    settled_credits: number | null;
    result_json: ScoringResult | null;
    failure_reason: string | null;
    created_at: string;
  };
  files: ScoringFile[];
}

interface PollState {
  timeoutId: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  attempt: number;
}

// ---------------------------------------------------------------------------
// Polling config — matches plan (5s initial, +3s step, cap 15s, total 25 min)
// ---------------------------------------------------------------------------

const POLL_INITIAL_MS = 5000;
const POLL_INCREMENT_MS = 3000;
const POLL_MAX_MS = 15000;
const POLL_TIMEOUT_MS = 25 * 60 * 1000;

function getPollDelay(attempt: number) {
  return Math.min(POLL_INITIAL_MS + attempt * POLL_INCREMENT_MS, POLL_MAX_MS);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Files the backend accepts for scoring (image types enumerated explicitly so
// users see a clear rejection on the client before upload).
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'txt', 'md', 'markdown', 'png', 'jpg', 'jpeg', 'webp', 'gif',
]);
const REJECTED_WORD_EXTENSIONS = new Set(['doc', 'rtf', 'odt']);

const SCENARIO_LABEL: Record<string, string> = {
  rubric: '按上传的评分标准 (Rubric) 评审',
  brief_only: '按任务要求 (Brief) 评审',
  article_only: '仅上传文章，按默认 5 维度评审',
};

function scoreColorClass(score: number) {
  if (score >= 85) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (score >= 75) return 'text-green-700 bg-green-50 border-green-200';
  if (score >= 60) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Scoring() {
  const navigate = useNavigate();

  // Input state
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active scoring state
  const [scoringData, setScoringData] = useState<ScoringData | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  // Result sub-tab (overall vs dimensions)
  const [resultTab, setResultTab] = useState<'overall' | 'dimensions'>('overall');

  const pollRef = useRef<PollState>({ timeoutId: null, startedAt: 0, attempt: 0 });
  const { refreshBalance } = useBalance();

  // --- Polling helpers ---
  const stopPolling = useCallback(() => {
    if (pollRef.current.timeoutId) {
      clearTimeout(pollRef.current.timeoutId);
      pollRef.current.timeoutId = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback((scoringId: string) => {
    stopPolling();
    setIsPolling(true);
    pollRef.current = { timeoutId: null, startedAt: Date.now(), attempt: 0 };

    const poll = async () => {
      try {
        if (Date.now() - pollRef.current.startedAt >= POLL_TIMEOUT_MS) {
          setError('评审处理超时，请刷新页面查看最新状态。');
          stopPolling();
          return;
        }

        const data = await api.getScoring(scoringId) as ScoringData;
        setScoringData(data);

        if (data.scoring.status === 'completed' || data.scoring.status === 'failed') {
          stopPolling();
          refreshBalance();
          return;
        }

        pollRef.current.attempt++;
        const delay = getPollDelay(pollRef.current.attempt);
        pollRef.current.timeoutId = setTimeout(poll, delay);
      } catch {
        // Retry on transient error
        pollRef.current.attempt++;
        const delay = getPollDelay(pollRef.current.attempt);
        pollRef.current.timeoutId = setTimeout(poll, delay);
      }
    };

    const delay = getPollDelay(0);
    pollRef.current.timeoutId = setTimeout(poll, delay);
  }, [stopPolling, refreshBalance]);

  // --- Load existing scoring on mount ---
  useEffect(() => {
    let cancelled = false;

    async function loadCurrent() {
      try {
        const data = await api.getScoringCurrent() as ScoringData | null;
        if (cancelled) return;
        if (data) {
          setScoringData(data);
          if (data.scoring.status === 'initializing' || data.scoring.status === 'processing') {
            startPolling(data.scoring.id);
          }
        }
      } catch {
        // Non-critical: show input state instead
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadCurrent();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  // --- File handling ---
  const filterAndValidateFiles = useCallback((incoming: File[]): File[] => {
    const accepted: File[] = [];
    for (const f of incoming) {
      const ext = f.name.toLowerCase().split('.').pop() || '';
      if (REJECTED_WORD_EXTENSIONS.has(ext)) {
        setError(`暂不支持 .doc/.rtf/.odt 格式（${f.name}），请另存为 .docx 或 PDF 后上传。`);
        continue;
      }
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        setError(`不支持的文件类型：${f.name}。当前支持 PDF、DOCX、PNG/JPG/WEBP/GIF 图片、TXT/MD 文本。`);
        continue;
      }
      accepted.push(f);
    }
    return accepted;
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const valid = filterAndValidateFiles(Array.from(e.target.files));
      if (valid.length > 0) {
        setError(null);
        setFiles(prev => [...prev, ...valid]);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [filterAndValidateFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    const valid = filterAndValidateFiles(droppedFiles);
    if (valid.length > 0) {
      setError(null);
      setFiles(prev => [...prev, ...valid]);
    }
  }, [filterAndValidateFiles]);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  // --- Submit ---
  const handleSubmit = async () => {
    if (files.length === 0) return;
    setError(null);
    setIsSubmitting(true);

    try {
      // 后端返回的是完整 scoring row (initializing 状态)，但前端只需要知道 id + status 就能进轮询
      const result = await api.createScoring(files) as {
        id: string;
        status: 'initializing' | 'processing';
        [key: string]: unknown;
      };
      // 用返回值构造一个占位 ScoringData，轮询会很快用真实数据替换掉
      setScoringData({
        scoring: {
          id: result.id,
          status: result.status,
          scenario: (result.scenario as any) ?? null,
          overall_score: null,
          scoring_word_count: null,
          input_word_count: Number(result.input_word_count) || 0,
          frozen_credits: Number(result.frozen_credits) || 0,
          settled_credits: null,
          result_json: null,
          failure_reason: null,
          created_at: typeof result.created_at === 'string' ? result.created_at : new Date().toISOString(),
        },
        files: [],
      });
      setFiles([]);
      refreshBalance();
      startPolling(result.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '提交失败，请稍后重试。';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Download PDF report ---
  const handleDownload = async () => {
    if (!scoringData) return;
    const report = scoringData.files.find(f => f.category === 'report');
    if (!report) {
      setError('暂无可下载的评审报告。');
      return;
    }
    setIsDownloading(true);
    try {
      const { url } = await api.getScoringReportDownloadUrl(
        scoringData.scoring.id,
        report.id,
      ) as { url: string; filename?: string };
      triggerDownload(url, report.original_name);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '下载失败。';
      setError(msg);
    } finally {
      setIsDownloading(false);
    }
  };

  // --- Reset to input state ---
  const handleNewScoring = () => {
    setScoringData(null);
    setError(null);
    setFiles([]);
    setResultTab('overall');
  };

  // --- Loading ---
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-red-700" />
      </div>
    );
  }

  const status = scoringData?.scoring?.status;
  const isActive = status === 'initializing' || status === 'processing';
  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';
  const showInput = !scoringData || isFailed;
  const result = scoringData?.scoring?.result_json ?? null;

  // =======================================================================
  // RENDER
  // =======================================================================
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">文章评审</h1>
          <p className="mt-1 text-sm text-gray-500">
            上传需要评审的文章（可附带评分标准 rubric 或任务要求），AI 将模拟学术评审给出总分、分维度打分和改进建议。
          </p>
        </div>
        <button
          onClick={() => navigate('/dashboard/tasks?tab=scorings')}
          className="text-sm text-gray-500 hover:text-red-700 transition-colors whitespace-nowrap mt-1"
        >
          查看评审历史 &rarr;
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-red-700">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* STATE: Initializing / Processing */}
      {/* ================================================================= */}
      {isActive && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-red-700 mx-auto" />
          <h2 className="text-lg font-semibold text-gray-900">
            {status === 'initializing' ? '正在验证材料' : '正在评审您的文章'}
          </h2>
          <p className="text-sm text-gray-500">
            {status === 'initializing'
              ? 'AI 正在提取文件内容并计算字数，通常 30-90 秒...'
              : 'AI 正在模拟学术评审（通常 3-10 分钟），请耐心等待...'}
          </p>
          <p className="text-xs text-gray-400">
            页面会自动刷新状态，请勿关闭此页面
          </p>
        </div>
      )}

      {/* ================================================================= */}
      {/* STATE: Completed */}
      {/* ================================================================= */}
      {isCompleted && scoringData && result && (
        <div className="space-y-4">
          {/* Success header + overall score */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-900">评审完成</p>
                <p className="text-xs text-green-700 mt-0.5">
                  {scoringData.scoring.scenario
                    ? SCENARIO_LABEL[scoringData.scoring.scenario] || ''
                    : ''}
                </p>
              </div>
            </div>
            <div className={`flex flex-col items-center rounded-xl border-2 px-5 py-2 ${scoreColorClass(result.overall_score)}`}>
              <span className="text-3xl font-bold leading-none">{result.overall_score}</span>
              <span className="text-xs mt-0.5 opacity-75">/ 100</span>
            </div>
          </div>

          {/* Credits summary */}
          {scoringData.scoring.settled_credits !== null && (
            <div className="text-xs text-gray-500 px-1">
              <FileText className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
              本次评审正文 {scoringData.scoring.scoring_word_count?.toLocaleString() ?? '-'} 词，消耗 {scoringData.scoring.settled_credits} 积分
              {scoringData.scoring.frozen_credits > scoringData.scoring.settled_credits && (
                <span className="ml-1 text-green-700">（已退回 {scoringData.scoring.frozen_credits - scoringData.scoring.settled_credits} 积分）</span>
              )}
            </div>
          )}

          {/* Result tabs */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setResultTab('overall')}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  resultTab === 'overall'
                    ? 'border-red-700 text-red-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                总评
              </button>
              <button
                onClick={() => setResultTab('dimensions')}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  resultTab === 'dimensions'
                    ? 'border-red-700 text-red-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                分维度打分 ({result.dimensions.length})
              </button>
            </div>

            {/* Overall tab */}
            {resultTab === 'overall' && (
              <div className="p-5 space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">总体评价</h3>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {result.overall_comment}
                  </p>
                </div>

                {result.top_suggestions.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">优先改进建议</h3>
                    <ol className="list-decimal list-inside space-y-1.5 text-sm text-gray-700">
                      {result.top_suggestions.map((s, i) => (
                        <li key={i} className="leading-relaxed">{s}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {result.detected_files.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">识别到的材料</h3>
                    <ul className="space-y-1.5 text-xs text-gray-600">
                      {result.detected_files.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <File className="h-3.5 w-3.5 mt-0.5 text-gray-400 flex-shrink-0" />
                          <div>
                            <span className="font-mono">{f.filename}</span>
                            <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                              {f.role === 'article' ? '待评审文章'
                                : f.role === 'rubric' ? '评分标准'
                                : f.role === 'brief' ? '任务要求' : '其它'}
                            </span>
                            {f.note && (
                              <p className="mt-0.5 text-gray-500 italic">{f.note}</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Dimensions tab */}
            {resultTab === 'dimensions' && (
              <div className="p-5 space-y-4">
                {result.dimensions.map((d, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">{d.name}</h4>
                        <p className="text-xs text-gray-500 mt-0.5">权重 {d.weight}%</p>
                      </div>
                      <div className={`flex-shrink-0 px-3 py-1 rounded-md border text-sm font-semibold ${scoreColorClass(d.score)}`}>
                        {d.score}
                      </div>
                    </div>

                    {d.strengths.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-emerald-700 uppercase mb-1">优点</p>
                        <ul className="list-disc list-inside space-y-1 text-xs text-gray-700">
                          {d.strengths.map((s, j) => <li key={j} className="leading-relaxed">{s}</li>)}
                        </ul>
                      </div>
                    )}

                    {d.weaknesses.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-amber-700 uppercase mb-1">不足</p>
                        <ul className="list-disc list-inside space-y-1 text-xs text-gray-700">
                          {d.weaknesses.map((w, j) => <li key={j} className="leading-relaxed">{w}</li>)}
                        </ul>
                      </div>
                    )}

                    {d.suggestions.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-blue-700 uppercase mb-1">建议</p>
                        <ul className="list-disc list-inside space-y-1 text-xs text-gray-700">
                          {d.suggestions.map((s, j) => <li key={j} className="leading-relaxed">{s}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Download + New scoring buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleDownload}
              disabled={isDownloading || !scoringData.files.some(f => f.category === 'report')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-700 text-white text-sm font-medium rounded-md hover:bg-red-800 disabled:opacity-50 transition-colors"
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              下载 PDF 报告
            </button>
            <button
              onClick={handleNewScoring}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              开始新的评审
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STATE: Failed */}
      {/* ================================================================= */}
      {isFailed && scoringData && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-800">评审失败</p>
              <p className="text-sm text-red-600 mt-1">
                {scoringData.scoring.failure_reason || '处理过程中发生错误。'}
              </p>
              <p className="text-xs text-red-500 mt-2">积分已自动退还到您的账户。</p>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STATE: Input */}
      {/* ================================================================= */}
      {showInput && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
          {/* File upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              上传评审材料
            </label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
                ${isDragging
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-300 hover:border-gray-400 bg-gray-50 hover:bg-gray-100'}
              `}
            >
              <UploadCloud className={`h-10 w-10 mx-auto mb-3 ${isDragging ? 'text-red-500' : 'text-gray-400'}`} />
              <p className="text-sm text-gray-600">
                拖拽文件到此处，或<span className="text-red-700 font-medium">点击选择</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">
                支持 PDF、DOCX、PNG/JPG/WEBP/GIF 图片、TXT/MD 文本，最多 10 个文件，每个不超过 20MB
              </p>
              <p className="text-xs text-gray-500 mt-1">
                上传顺序不影响，GPT 会自动识别哪份是待评审文章、哪份是评分标准
              </p>
              <p className="text-xs text-amber-600 mt-1">
                扫描件 PDF 和纯图片暂不支持（AI 需要可提取的文字进行评审）
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.docx"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {/* File list — extension + size only, no client-side role guessing */}
            {files.length > 0 && (
              <div className="mt-3 space-y-2">
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center gap-2 bg-gray-50 rounded-md px-3 py-2">
                    <File className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="text-sm text-gray-700 truncate flex-1">{file.name}</span>
                    <span className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(1)}MB</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cost hint */}
          <div className="text-xs text-gray-500 space-y-1">
            <p>
              <Gauge className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
              单价 0.1 积分/word，汉字按字、英文按词各计 1 个 word，按实际评审的正文字数结算。
            </p>
            <p>
              <FileText className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
              提交时会按所有上传文件精确提取的字数冻结积分；AI 识别完成后按正文字数结算，多余部分自动退回。
            </p>
          </div>

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || files.length === 0}
            className="w-full py-2.5 bg-red-700 text-white text-sm font-medium rounded-md hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在提交...
              </>
            ) : (
              '开始评审'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
