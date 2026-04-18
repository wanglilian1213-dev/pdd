import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  UploadCloud,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  X,
  File as FileIcon,
  Bot,
  Shield,
  Sparkles,
} from 'lucide-react';
import { api } from '../../lib/api';
import { triggerDownload } from '../../lib/downloadFile';
import { useBalance } from '../../contexts/BalanceContext';

// ============================================================================
// 公共常量 & 类型
// ============================================================================

const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md']);
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

// 轮询参数：对齐 scoring/revision 的保守值
const POLL_INITIAL_MS_DETECTION = 2000;
const POLL_INCREMENT_MS_DETECTION = 2000;
const POLL_MAX_MS = 15000;
const POLL_TIMEOUT_DETECTION_MS = 15 * 60 * 1000; // 15 min
const POLL_INITIAL_MS_HUMANIZE = 5000;
const POLL_INCREMENT_MS_HUMANIZE = 3000;
const POLL_TIMEOUT_HUMANIZE_MS = 20 * 60 * 1000; // 20 min

interface PollState {
  timeoutId: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  attempt: number;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExt(name: string): string {
  return name.toLowerCase().split('.').pop() || '';
}

// ============================================================================
// 检测 AI 类型
// ============================================================================

interface DetectionResultDetails {
  scoreGptZero?: number;
  scoreOpenAI?: number;
  scoreWriter?: number;
  scoreCrossPlag?: number;
  scoreCopyLeaks?: number;
  scoreSapling?: number;
  scoreContentAtScale?: number;
  scoreZeroGPT?: number;
  human?: number;
  [key: string]: number | undefined;
}

interface DetectionResultJson {
  overall_score?: number;
  result_details?: DetectionResultDetails;
  undetectable_document_id?: string;
  raw?: Record<string, unknown>;
}

interface DetectionFile {
  id: string;
  original_name: string;
  file_size: number;
  mime_type: string;
  extracted_word_count: number | null;
  created_at: string;
  expires_at: string | null;
}

interface DetectionData {
  detection: {
    id: string;
    status: 'initializing' | 'processing' | 'completed' | 'failed';
    overall_score: number | null;
    input_word_count: number;
    frozen_credits: number;
    settled_credits: number | null;
    result_json: DetectionResultJson | null;
    failure_reason: string | null;
    created_at: string;
  };
  files: DetectionFile[];
}

interface EstimateDetectionInfo {
  filename: string;
  words: number;
  pricePerWord: number;
  estimatedAmount: number;
  tooShort: boolean;
  tooLong: boolean;
  isScannedPdf: boolean;
  isImage: boolean;
}

// ============================================================================
// 独立降 AI 类型
// ============================================================================

interface HumanizationFile {
  id: string;
  category: 'material' | 'humanized_doc';
  original_name: string;
  file_size: number;
  mime_type: string;
  created_at: string;
  expires_at: string | null;
}

interface HumanizationData {
  humanization: {
    id: string;
    status: 'initializing' | 'processing' | 'completed' | 'failed';
    input_word_count: number;
    humanized_word_count: number | null;
    frozen_credits: number;
    settled_credits: number | null;
    humanized_text: string | null;
    failure_reason: string | null;
    acknowledged: boolean;
    created_at: string;
  };
  files: HumanizationFile[];
}

interface EstimateHumanizeInfo {
  filename: string;
  words: number;
  pricePerWord: number;
  estimatedAmount: number;
  tooShort: boolean;
  tooLong: boolean;
  isScannedPdf: boolean;
  isImage: boolean;
}

// ============================================================================
// 检测 AI 子组件
// ============================================================================

// 8 家检测器的显示顺序和标签（前端统一展示为"AI 概率"：100 - scoreXxx）
const DETECTOR_ENTRIES: Array<{ key: keyof DetectionResultDetails; label: string }> = [
  { key: 'scoreGptZero', label: 'GPTZero' },
  { key: 'scoreOpenAI', label: 'OpenAI' },
  { key: 'scoreCopyLeaks', label: 'Copyleaks' },
  { key: 'scoreSapling', label: 'Sapling' },
  { key: 'scoreWriter', label: 'Writer' },
  { key: 'scoreContentAtScale', label: 'Content At Scale' },
  { key: 'scoreZeroGPT', label: 'ZeroGPT' },
  { key: 'scoreCrossPlag', label: 'CrossPlag' },
];

function aiColorClass(aiPct: number) {
  // 越高越像 AI → 越红
  if (aiPct >= 60) return 'bg-red-500';
  if (aiPct >= 30) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function aiTextColorClass(aiPct: number) {
  if (aiPct >= 60) return 'text-red-700 border-red-200 bg-red-50';
  if (aiPct >= 30) return 'text-amber-700 border-amber-200 bg-amber-50';
  return 'text-emerald-700 border-emerald-200 bg-emerald-50';
}

function DetectionTab({ refreshBalance }: { refreshBalance: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<EstimateDetectionInfo | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<DetectionData | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const pollRef = useRef<PollState>({ timeoutId: null, startedAt: 0, attempt: 0 });

  const stopPolling = useCallback(() => {
    if (pollRef.current.timeoutId) {
      clearTimeout(pollRef.current.timeoutId);
      pollRef.current.timeoutId = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback(
    (detectionId: string) => {
      stopPolling();
      setIsPolling(true);
      pollRef.current = { timeoutId: null, startedAt: Date.now(), attempt: 0 };

      const poll = async () => {
        try {
          if (Date.now() - pollRef.current.startedAt >= POLL_TIMEOUT_DETECTION_MS) {
            setError('检测超时，请刷新页面查看最新状态。');
            stopPolling();
            return;
          }
          const resp = (await api.getAiDetection(detectionId)) as DetectionData;
          setData(resp);
          if (resp.detection.status === 'completed' || resp.detection.status === 'failed') {
            stopPolling();
            refreshBalance();
            return;
          }
          pollRef.current.attempt++;
          const delay = Math.min(
            POLL_INITIAL_MS_DETECTION + pollRef.current.attempt * POLL_INCREMENT_MS_DETECTION,
            POLL_MAX_MS,
          );
          pollRef.current.timeoutId = setTimeout(poll, delay);
        } catch {
          pollRef.current.attempt++;
          const delay = Math.min(
            POLL_INITIAL_MS_DETECTION + pollRef.current.attempt * POLL_INCREMENT_MS_DETECTION,
            POLL_MAX_MS,
          );
          pollRef.current.timeoutId = setTimeout(poll, delay);
        }
      };
      pollRef.current.timeoutId = setTimeout(poll, POLL_INITIAL_MS_DETECTION);
    },
    [stopPolling, refreshBalance],
  );

  // Load current on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = (await api.getAiDetectionCurrent()) as DetectionData | null;
        if (cancelled) return;
        if (resp) {
          setData(resp);
          if (
            resp.detection.status === 'initializing'
            || resp.detection.status === 'processing'
          ) {
            startPolling(resp.detection.id);
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  const pickFile = useCallback(async (f: File) => {
    const ext = fileExt(f.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      setError(`不支持 .${ext} 文件。仅支持 PDF / DOCX / TXT。`);
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError(`文件超过 ${MAX_FILE_SIZE_MB} MB 限制。`);
      return;
    }
    setFile(f);
    setError(null);
    setEstimate(null);
    setIsEstimating(true);
    try {
      const est = await api.estimateAiDetection(f);
      setEstimate(est);
    } catch (err) {
      setError(err instanceof Error ? err.message : '预估失败，请重试。');
    } finally {
      setIsEstimating(false);
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void pickFile(f);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void pickFile(f);
  };

  const handleRemove = () => {
    setFile(null);
    setEstimate(null);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!file) return;
    if (!estimate) {
      setError('正在预估费用，请稍候。');
      return;
    }
    if (estimate.isScannedPdf) {
      setError('这似乎是扫描件 PDF，无法提取文字。请上传文字版 PDF 或 DOCX。');
      return;
    }
    if (estimate.tooShort) {
      setError(`文章至少需要 200 词，当前只有 ${estimate.words} 词。`);
      return;
    }
    if (estimate.tooLong) {
      setError(`文章超出上限（30,000 词），当前 ${estimate.words} 词。请删减后重试。`);
      return;
    }

    // 余额前置校验
    try {
      const profile = (await api.getProfile()) as { balance?: number };
      const balance = profile?.balance ?? 0;
      if (estimate.estimatedAmount > balance) {
        setError(
          `需要 ${estimate.estimatedAmount} 积分，您当前余额 ${balance} 积分，请先充值后再操作。`,
        );
        return;
      }
    } catch {
      /* 余额查询失败不阻断，由后端兜底 */
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const resp = (await api.createAiDetection(file)) as { id: string; status: string };
      setFile(null);
      setEstimate(null);
      // 立即拉一次以拿到完整 data
      const full = (await api.getAiDetection(resp.id)) as DetectionData;
      setData(full);
      startPolling(resp.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后重试。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setData(null);
    setFile(null);
    setEstimate(null);
    setError(null);
    stopPolling();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  // 显示结果页（completed / failed 或 processing）
  if (data && data.detection.status !== 'initializing') {
    const d = data.detection;
    const results = d.result_json?.result_details || {};
    const overall = d.overall_score ?? 0;

    return (
      <div className="space-y-4">
        {d.status === 'processing' && (
          <div className="border border-blue-200 bg-blue-50 rounded-lg p-6 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <div>
              <div className="font-medium text-blue-900">正在检测中...</div>
              <div className="text-sm text-blue-700">
                Undetectable 通常 2-4 秒出结果，最多等 15 分钟。
              </div>
            </div>
          </div>
        )}

        {d.status === 'failed' && (
          <div className="border border-red-200 bg-red-50 rounded-lg p-6 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-red-900">检测失败</div>
              <div className="text-sm text-red-700 mt-1">
                {d.failure_reason || '未知错误，请重试。'}
              </div>
              <button
                onClick={handleReset}
                className="mt-3 text-sm text-red-700 underline hover:text-red-900"
              >
                重新开始检测
              </button>
            </div>
          </div>
        )}

        {d.status === 'completed' && (
          <>
            <div className={`border rounded-lg p-6 ${aiTextColorClass(overall)}`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-medium opacity-80">综合 AI 可能性</div>
                  <div className="text-4xl font-bold mt-1">{Math.round(overall)}%</div>
                </div>
                <div className="text-right text-sm opacity-80">
                  <div>检测字数：{d.input_word_count.toLocaleString()} 词</div>
                  <div>实际扣费：{d.settled_credits ?? 0} 积分</div>
                </div>
              </div>
              <div className="h-3 bg-white/60 rounded-full overflow-hidden">
                <div
                  className={`h-full ${aiColorClass(overall)} transition-all duration-500`}
                  style={{ width: `${Math.min(100, Math.max(0, overall))}%` }}
                />
              </div>
              <div className="text-xs mt-3 opacity-80">
                {overall >= 60
                  ? '⚠️ 大概率会被检测器判定为 AI 生成，建议用降 AI 处理一次。'
                  : overall >= 30
                  ? '⚠️ 部分检测器可能判定为 AI 生成，边界文本，建议谨慎。'
                  : '✅ 多数检测器判定为人工写作，可较安全提交。'}
              </div>
            </div>

            <div className="border border-gray-200 bg-white rounded-lg p-6">
              <h3 className="text-sm font-medium text-gray-800 mb-3">
                各检测器明细（全部已换算为 AI 概率）
              </h3>
              <div className="space-y-2">
                {DETECTOR_ENTRIES.map(({ key, label }) => {
                  const humanScore = results[key];
                  if (humanScore === undefined || humanScore === null) {
                    return (
                      <div key={key} className="flex items-center gap-3 text-sm">
                        <div className="w-32 text-gray-600">{label}</div>
                        <div className="flex-1 text-xs text-gray-400">未返回数据</div>
                      </div>
                    );
                  }
                  // Undetectable 的 scoreXxx 是"人工 %"，换算成 AI %
                  const aiPct = Math.max(0, Math.min(100, 100 - humanScore));
                  return (
                    <div key={key} className="flex items-center gap-3 text-sm">
                      <div className="w-32 text-gray-700 shrink-0">{label}</div>
                      <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                        <div
                          className={`h-full ${aiColorClass(aiPct)} transition-all duration-500`}
                          style={{ width: `${aiPct}%` }}
                        />
                      </div>
                      <div className="w-12 text-right text-gray-700 shrink-0">
                        {Math.round(aiPct)}%
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-gray-500 mt-4">
                说明：本分数由 Undetectable.ai 官方 API 返回。子检测器原始返回为"人工编写百分比"，
                这里统一换算为"AI 概率"以便直观对比（分数越高越像 AI）。
              </div>
            </div>

            <button
              onClick={handleReset}
              className="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
            >
              再检测一篇
            </button>
          </>
        )}
      </div>
    );
  }

  // 上传表单（包含 initializing 和未开始两种）
  return (
    <div className="space-y-4">
      {data?.detection.status === 'initializing' && (
        <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <span className="text-sm text-blue-800">正在解析文件并冻结积分...</span>
        </div>
      )}

      {!file ? (
        <div
          className={`
            border-2 border-dashed rounded-lg p-10 text-center transition-colors cursor-pointer
            ${isDragging ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}
          `}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadCloud className="h-10 w-10 text-gray-400 mx-auto mb-3" />
          <div className="text-gray-800 font-medium">拖拽或点击上传文章</div>
          <div className="text-sm text-gray-500 mt-1">
            支持 PDF（文字版）/ DOCX / TXT，最大 20 MB
          </div>
          <div className="text-xs text-gray-400 mt-1">
            文章需至少 200 词，最多 30,000 词
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      ) : (
        <div className="border border-gray-200 bg-white rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileIcon className="h-5 w-5 text-gray-500" />
              <div>
                <div className="font-medium text-gray-900">{file.name}</div>
                <div className="text-xs text-gray-500">{formatBytes(file.size)}</div>
              </div>
            </div>
            <button
              onClick={handleRemove}
              className="text-gray-400 hover:text-gray-600"
              disabled={isSubmitting}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-3 pt-3 border-t border-gray-100 text-sm">
            {isEstimating ? (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在解析字数...
              </div>
            ) : estimate ? (
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">识别字数</span>
                  <span className="font-medium text-gray-900">
                    {estimate.words.toLocaleString()} 词
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">预估费用</span>
                  <span className="font-medium text-red-700">
                    {estimate.estimatedAmount} 积分（{estimate.pricePerWord} 积分/字）
                  </span>
                </div>
                {estimate.isScannedPdf && (
                  <div className="text-xs text-red-600 mt-2">
                    ⚠️ 这似乎是扫描件 PDF，无法提取文字，请换文字版 PDF 或 DOCX。
                  </div>
                )}
                {estimate.tooShort && !estimate.isScannedPdf && (
                  <div className="text-xs text-red-600 mt-2">
                    ⚠️ 文章至少需要 200 词。
                  </div>
                )}
                {estimate.tooLong && (
                  <div className="text-xs text-red-600 mt-2">
                    ⚠️ 文章超出 30,000 词上限，请删减后重试。
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {error && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={
          !file
          || isSubmitting
          || isEstimating
          || !estimate
          || estimate.isScannedPdf
          || estimate.tooShort
          || estimate.tooLong
        }
        className="w-full px-4 py-3 bg-red-700 text-white rounded-lg hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            提交中...
          </span>
        ) : (
          '开始检测'
        )}
      </button>
    </div>
  );
}

// ============================================================================
// 独立降 AI 子组件
// ============================================================================

function HumanizationTab({ refreshBalance }: { refreshBalance: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<EstimateHumanizeInfo | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<HumanizationData | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const pollRef = useRef<PollState>({ timeoutId: null, startedAt: 0, attempt: 0 });

  const stopPolling = useCallback(() => {
    if (pollRef.current.timeoutId) {
      clearTimeout(pollRef.current.timeoutId);
      pollRef.current.timeoutId = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback(
    (humanizationId: string) => {
      stopPolling();
      setIsPolling(true);
      pollRef.current = { timeoutId: null, startedAt: Date.now(), attempt: 0 };

      const poll = async () => {
        try {
          if (Date.now() - pollRef.current.startedAt >= POLL_TIMEOUT_HUMANIZE_MS) {
            setError('降 AI 超时，请刷新页面查看最新状态。');
            stopPolling();
            return;
          }
          const resp = (await api.getStandaloneHumanize(humanizationId)) as HumanizationData;
          setData(resp);
          if (
            resp.humanization.status === 'completed'
            || resp.humanization.status === 'failed'
          ) {
            stopPolling();
            refreshBalance();
            return;
          }
          pollRef.current.attempt++;
          const delay = Math.min(
            POLL_INITIAL_MS_HUMANIZE + pollRef.current.attempt * POLL_INCREMENT_MS_HUMANIZE,
            POLL_MAX_MS,
          );
          pollRef.current.timeoutId = setTimeout(poll, delay);
        } catch {
          pollRef.current.attempt++;
          const delay = Math.min(
            POLL_INITIAL_MS_HUMANIZE + pollRef.current.attempt * POLL_INCREMENT_MS_HUMANIZE,
            POLL_MAX_MS,
          );
          pollRef.current.timeoutId = setTimeout(poll, delay);
        }
      };
      pollRef.current.timeoutId = setTimeout(poll, POLL_INITIAL_MS_HUMANIZE);
    },
    [stopPolling, refreshBalance],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = (await api.getStandaloneHumanizeCurrent()) as HumanizationData | null;
        if (cancelled) return;
        if (resp) {
          setData(resp);
          if (
            resp.humanization.status === 'initializing'
            || resp.humanization.status === 'processing'
          ) {
            startPolling(resp.humanization.id);
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  const pickFile = useCallback(async (f: File) => {
    const ext = fileExt(f.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      setError(`不支持 .${ext} 文件。仅支持 PDF / DOCX / TXT。`);
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError(`文件超过 ${MAX_FILE_SIZE_MB} MB 限制。`);
      return;
    }
    setFile(f);
    setError(null);
    setEstimate(null);
    setIsEstimating(true);
    try {
      const est = await api.estimateStandaloneHumanize(f);
      setEstimate(est);
    } catch (err) {
      setError(err instanceof Error ? err.message : '预估失败，请重试。');
    } finally {
      setIsEstimating(false);
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void pickFile(f);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void pickFile(f);
  };

  const handleRemove = () => {
    setFile(null);
    setEstimate(null);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!file || !estimate) return;
    if (estimate.isScannedPdf) {
      setError('这似乎是扫描件 PDF，无法提取文字。请上传文字版 PDF 或 DOCX。');
      return;
    }
    if (estimate.tooShort) {
      setError(`文章至少需要 500 词，当前只有 ${estimate.words} 词。`);
      return;
    }
    if (estimate.tooLong) {
      setError(`文章超出上限（30,000 词），当前 ${estimate.words} 词。请删减后重试。`);
      return;
    }

    try {
      const profile = (await api.getProfile()) as { balance?: number };
      const balance = profile?.balance ?? 0;
      if (estimate.estimatedAmount > balance) {
        setError(
          `需要 ${estimate.estimatedAmount} 积分，您当前余额 ${balance} 积分，请先充值后再操作。`,
        );
        return;
      }
    } catch {
      /* 由后端兜底 */
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const resp = (await api.createStandaloneHumanize(file)) as { id: string; status: string };
      setFile(null);
      setEstimate(null);
      const full = (await api.getStandaloneHumanize(resp.id)) as HumanizationData;
      setData(full);
      startPolling(resp.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后重试。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownload = async (fileId: string) => {
    if (!data) return;
    setIsDownloading(true);
    try {
      const { url, filename } = (await api.getStandaloneHumanizeDownloadUrl(
        data.humanization.id,
        fileId,
      )) as { url: string; filename: string };
      triggerDownload(url, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败，请重试。');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleReset = async () => {
    // 把当前记录标 acknowledged，切回时不再恢复
    if (data && (data.humanization.status === 'completed' || data.humanization.status === 'failed')) {
      try {
        await api.acknowledgeStandaloneHumanize(data.humanization.id);
      } catch {
        /* 忽略，下次切回最多多提示一次 */
      }
    }
    stopPolling();
    setData(null);
    setFile(null);
    setEstimate(null);
    setError(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  if (data && data.humanization.status !== 'initializing' && data.humanization.status !== 'processing') {
    const h = data.humanization;
    const humanizedDoc = data.files.find((f) => f.category === 'humanized_doc');

    return (
      <div className="space-y-4">
        {h.status === 'failed' && (
          <div className="border border-red-200 bg-red-50 rounded-lg p-6 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-red-900">降 AI 失败</div>
              <div className="text-sm text-red-700 mt-1">
                {h.failure_reason || '未知错误，请重试。'}
              </div>
              <button
                onClick={handleReset}
                className="mt-3 text-sm text-red-700 underline hover:text-red-900"
              >
                重新开始
              </button>
            </div>
          </div>
        )}

        {h.status === 'completed' && (
          <>
            <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-3">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                <div className="font-medium text-emerald-900">降 AI 处理完成</div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-emerald-700 opacity-80">原文字数</div>
                  <div className="font-medium text-emerald-900">
                    {h.input_word_count.toLocaleString()} 词
                  </div>
                </div>
                <div>
                  <div className="text-emerald-700 opacity-80">降 AI 后字数</div>
                  <div className="font-medium text-emerald-900">
                    {(h.humanized_word_count ?? 0).toLocaleString()} 词
                  </div>
                </div>
                <div>
                  <div className="text-emerald-700 opacity-80">实际扣费</div>
                  <div className="font-medium text-emerald-900">
                    {h.settled_credits ?? 0} 积分
                  </div>
                </div>
                <div>
                  <div className="text-emerald-700 opacity-80">预冻结</div>
                  <div className="font-medium text-emerald-900">{h.frozen_credits} 积分</div>
                </div>
              </div>
            </div>

            {humanizedDoc && (
              <div className="border border-gray-200 bg-white rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-gray-500" />
                    <div>
                      <div className="font-medium text-gray-900">{humanizedDoc.original_name}</div>
                      <div className="text-xs text-gray-500">
                        {formatBytes(humanizedDoc.file_size)}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownload(humanizedDoc.id)}
                    disabled={isDownloading}
                    className="px-4 py-2 bg-red-700 text-white rounded-lg hover:bg-red-800 disabled:opacity-50 text-sm flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    下载
                  </button>
                </div>
                <div className="text-xs text-gray-500 mt-3">
                  说明：降 AI 后的 Word 文档为纯正文版本，不包含课程编号、封面、参考文献模板。
                </div>
              </div>
            )}

            <button
              onClick={handleReset}
              className="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
            >
              降下一篇
            </button>
          </>
        )}
      </div>
    );
  }

  // 处理中 / 上传中
  if (data && (data.humanization.status === 'initializing' || data.humanization.status === 'processing')) {
    return (
      <div className="space-y-4">
        <div className="border border-blue-200 bg-blue-50 rounded-lg p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-3" />
          <div className="font-medium text-blue-900 text-lg">
            {data.humanization.status === 'initializing'
              ? '正在解析文件并冻结积分...'
              : '正在进行深度降 AI 处理...'}
          </div>
          <div className="text-sm text-blue-700 mt-2">
            通常需要 2-10 分钟，请耐心等待，页面可保持打开。
          </div>
          <div className="text-xs text-blue-600 mt-3">
            文章字数：{data.humanization.input_word_count.toLocaleString()} 词
            · 已冻结：{data.humanization.frozen_credits} 积分
          </div>
        </div>
      </div>
    );
  }

  // 上传表单
  return (
    <div className="space-y-4">
      {!file ? (
        <div
          className={`
            border-2 border-dashed rounded-lg p-10 text-center transition-colors cursor-pointer
            ${isDragging ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}
          `}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadCloud className="h-10 w-10 text-gray-400 mx-auto mb-3" />
          <div className="text-gray-800 font-medium">拖拽或点击上传文章</div>
          <div className="text-sm text-gray-500 mt-1">
            支持 PDF（文字版）/ DOCX / TXT，最大 20 MB
          </div>
          <div className="text-xs text-gray-400 mt-1">
            文章需至少 500 词，最多 30,000 词；结果为纯正文 Word 文档
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      ) : (
        <div className="border border-gray-200 bg-white rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileIcon className="h-5 w-5 text-gray-500" />
              <div>
                <div className="font-medium text-gray-900">{file.name}</div>
                <div className="text-xs text-gray-500">{formatBytes(file.size)}</div>
              </div>
            </div>
            <button
              onClick={handleRemove}
              className="text-gray-400 hover:text-gray-600"
              disabled={isSubmitting}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-3 pt-3 border-t border-gray-100 text-sm">
            {isEstimating ? (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在解析字数...
              </div>
            ) : estimate ? (
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">识别字数</span>
                  <span className="font-medium text-gray-900">
                    {estimate.words.toLocaleString()} 词
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">预估费用</span>
                  <span className="font-medium text-red-700">
                    {estimate.estimatedAmount} 积分（{estimate.pricePerWord} 积分/字）
                  </span>
                </div>
                {estimate.isScannedPdf && (
                  <div className="text-xs text-red-600 mt-2">
                    ⚠️ 这似乎是扫描件 PDF，无法提取文字。
                  </div>
                )}
                {estimate.tooShort && !estimate.isScannedPdf && (
                  <div className="text-xs text-red-600 mt-2">
                    ⚠️ 文章至少需要 500 词。
                  </div>
                )}
                {estimate.tooLong && (
                  <div className="text-xs text-red-600 mt-2">
                    ⚠️ 文章超出 30,000 词上限，请删减后重试。
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {error && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={
          !file
          || isSubmitting
          || isEstimating
          || !estimate
          || estimate.isScannedPdf
          || estimate.tooShort
          || estimate.tooLong
        }
        className="w-full px-4 py-3 bg-red-700 text-white rounded-lg hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            提交中...
          </span>
        ) : (
          '开始降 AI'
        )}
      </button>
    </div>
  );
}

// ============================================================================
// 主页面：顶部 Tab 切换
// ============================================================================

type ActiveTab = 'detection' | 'humanization';

export default function AiTools() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('detection');
  const { refreshBalance } = useBalance();

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Bot className="h-6 w-6 text-red-700" />
          检测 AI / 降 AI
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          一次调用拿到 8 家主流检测器（GPTZero / OpenAI / Copyleaks / Sapling / Writer / ContentAtScale / ZeroGPT / CrossPlag）的聚合 AI 检测结果；
          或上传自己的文章直接降 AI 重写。
        </p>
      </div>

      {/* 顶部 Tab */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-4">
          <button
            onClick={() => setActiveTab('detection')}
            className={`
              py-3 px-1 border-b-2 text-sm font-medium flex items-center gap-2 transition-colors
              ${
                activeTab === 'detection'
                  ? 'border-red-700 text-red-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            <Shield className="h-4 w-4" />
            检测 AI
          </button>
          <button
            onClick={() => setActiveTab('humanization')}
            className={`
              py-3 px-1 border-b-2 text-sm font-medium flex items-center gap-2 transition-colors
              ${
                activeTab === 'humanization'
                  ? 'border-red-700 text-red-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            <Sparkles className="h-4 w-4" />
            降 AI
          </button>
        </nav>
      </div>

      {/* 两个 Tab 都渲染但用 display 切换，保证切换 Tab 时对方轮询不中断 */}
      <div style={{ display: activeTab === 'detection' ? 'block' : 'none' }}>
        <DetectionTab refreshBalance={refreshBalance} />
      </div>
      <div style={{ display: activeTab === 'humanization' ? 'block' : 'none' }}>
        <HumanizationTab refreshBalance={refreshBalance} />
      </div>
    </div>
  );
}
