import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, FileText, Loader2, CheckCircle2, AlertCircle, Download, X, File, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { triggerDownload } from '../../lib/downloadFile';
import { useBalance } from '../../contexts/BalanceContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RevisionFile {
  id: string;
  category: string;
  original_name: string;
  file_size: number;
  mime_type: string;
  created_at: string;
  expires_at: string | null;
}

interface RevisionData {
  revision: {
    id: string;
    status: 'processing' | 'completed' | 'failed';
    instructions: string;
    result_text: string | null;
    word_count: number | null;
    frozen_credits: number;
    failure_reason: string | null;
    created_at: string;
  };
  files: RevisionFile[];
}

interface PollState {
  timeoutId: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  attempt: number;
}

// ---------------------------------------------------------------------------
// Polling config (matches existing patterns)
// ---------------------------------------------------------------------------

const POLL_INITIAL_MS = 5000;
const POLL_INCREMENT_MS = 3000;
const POLL_MAX_MS = 15000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function getPollDelay(attempt: number) {
  return Math.min(POLL_INITIAL_MS + attempt * POLL_INCREMENT_MS, POLL_MAX_MS);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Revision() {
  const navigate = useNavigate();

  // --- Input state ---
  const [files, setFiles] = useState<File[]>([]);
  const [instructions, setInstructions] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Active revision state ---
  const [revisionData, setRevisionData] = useState<RevisionData | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  // --- Estimate state (前端实时显示预估字数 + 余额校验) ---
  // wordsByFile 用 File 对象做 key，文件列表变化时同步增减；
  // pricePerWord 由 estimate 接口返回，本地默认 0.2 兜底（system_config 默认值）
  const [wordsByFile, setWordsByFile] = useState<Map<File, number>>(new Map());
  const [pricePerWord, setPricePerWord] = useState<number>(0.2);
  const [estimatingCount, setEstimatingCount] = useState<number>(0);

  const pollRef = useRef<PollState>({ timeoutId: null, startedAt: 0, attempt: 0 });
  const { balance, refreshBalance } = useBalance();

  // 进入页面就拿一次最新余额（避免 BalanceProvider 刚初始化时 balance=null）
  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  // --- Helpers ---
  const stopPolling = useCallback(() => {
    if (pollRef.current.timeoutId) {
      clearTimeout(pollRef.current.timeoutId);
      pollRef.current.timeoutId = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback((revisionId: string) => {
    stopPolling();
    setIsPolling(true);
    pollRef.current = { timeoutId: null, startedAt: Date.now(), attempt: 0 };

    const poll = async () => {
      try {
        // Timeout check
        if (Date.now() - pollRef.current.startedAt >= POLL_TIMEOUT_MS) {
          setError('修改处理超时，请刷新页面查看最新状态。');
          stopPolling();
          return;
        }

        const data = await api.getRevision(revisionId) as RevisionData;
        setRevisionData(data);

        if (data.revision.status === 'completed') {
          stopPolling();
          refreshBalance();
          return;
        }

        if (data.revision.status === 'failed') {
          stopPolling();
          refreshBalance();
          return;
        }

        // Continue polling
        pollRef.current.attempt++;
        const delay = getPollDelay(pollRef.current.attempt);
        pollRef.current.timeoutId = setTimeout(poll, delay);
      } catch {
        // Retry on error
        pollRef.current.attempt++;
        const delay = getPollDelay(pollRef.current.attempt);
        pollRef.current.timeoutId = setTimeout(poll, delay);
      }
    };

    const delay = getPollDelay(0);
    pollRef.current.timeoutId = setTimeout(poll, delay);
  }, [stopPolling, refreshBalance]);

  // --- Load existing revision on mount ---
  useEffect(() => {
    let cancelled = false;

    async function loadCurrent() {
      try {
        const data = await api.getRevisionCurrent() as RevisionData | null;
        if (cancelled) return;

        if (data) {
          setRevisionData(data);
          if (data.revision.status === 'processing') {
            startPolling(data.revision.id);
          }
        }
      } catch {
        // Non-critical
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

  // --- File validation ---
  // 后端走 Anthropic Messages API，inline document 只接受 application/pdf。
  // .docx 后端会用 mammoth 抽成纯文本再上送。.doc/.rtf/.odt 仍不支持。
  const ALLOWED_EXTENSIONS = new Set([
    'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'md', 'markdown', 'docx',
  ]);
  const REJECTED_WORD_EXTENSIONS = new Set(['doc', 'rtf', 'odt']);

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

  // --- 单文件估算（增量预估）---
  // 后端 POST /api/revision/estimate 只接受单文件，返回 {filename, words, pricePerWord}。
  // 异步触发，不 await：每个文件独立成败，不阻断其他文件。
  // 失败兜底：除"扫描件 PDF"外，其余失败按 words=0 算（让 createRevision 真解析做最后兜底）。
  const estimateFile = useCallback((file: File) => {
    setEstimatingCount(c => c + 1);
    api.estimateRevisionFile(file)
      .then(({ words, pricePerWord: pw }) => {
        setWordsByFile(prev => {
          const next = new Map(prev);
          next.set(file, words);
          return next;
        });
        setPricePerWord(pw);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : '预估失败';
        // 扫描件 PDF：后端返回 400 + "看起来是扫描件 PDF"。前端直接把该文件移出列表 + 提示用户。
        if (/扫描件/.test(msg)) {
          setError(msg);
          setFiles(prev => prev.filter(f => f !== file));
          setWordsByFile(prev => {
            const next = new Map(prev);
            next.delete(file);
            return next;
          });
        } else {
          // 其他失败（网络 / 服务异常）→ 按 0 字兜底，不阻断提交
          setWordsByFile(prev => {
            const next = new Map(prev);
            next.set(file, 0);
            return next;
          });
        }
      })
      .finally(() => {
        setEstimatingCount(c => c - 1);
      });
  }, []);

  // --- File handlers ---
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const valid = filterAndValidateFiles(Array.from(e.target.files));
      if (valid.length > 0) {
        setError(null);
        setFiles(prev => [...prev, ...valid]);
        valid.forEach(estimateFile);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [filterAndValidateFiles, estimateFile]);

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
      valid.forEach(estimateFile);
    }
  }, [filterAndValidateFiles, estimateFile]);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => {
      const removed = prev[index];
      if (removed) {
        setWordsByFile(map => {
          const next = new Map(map);
          next.delete(removed);
          return next;
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // --- 派生：估算总字数 / 估算冻结金额 / 余额是否够 ---
  const estimatedWords: number = Array.from(wordsByFile.values()).reduce<number>(
    (sum, w) => sum + (typeof w === 'number' ? w : 0),
    0,
  );
  const estimatedAmount = Math.ceil(estimatedWords * pricePerWord);
  const isEstimating = estimatingCount > 0;
  const isInsufficient = balance != null && estimatedAmount > balance;

  // --- Submit ---
  const handleSubmit = async () => {
    if (files.length === 0 || !instructions.trim()) return;
    setError(null);
    setIsSubmitting(true);

    try {
      // 提交前再拉一次最新余额，避免本地 balance 已过期（充值 / 其他端扣费）
      // 直接调 api.getProfile 拿到当下值，避免等 state 更新闭包拿不到
      try {
        const profile = await api.getProfile();
        const latestBalance = profile?.balance ?? 0;
        if (estimatedAmount > latestBalance) {
          setError(`需要 ${estimatedAmount} 积分，您当前余额 ${latestBalance} 积分，请先充值后再操作。`);
          setIsSubmitting(false);
          refreshBalance();
          return;
        }
      } catch {
        // 拿余额失败不阻断提交，让后端真校验
      }

      const result = await api.createRevision(files, instructions.trim()) as any;
      setRevisionData({ revision: result, files: [] });
      setFiles([]);
      setInstructions('');
      setWordsByFile(new Map());
      refreshBalance();
      startPolling(result.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '提交失败，请稍后重试。';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Download ---
  const handleDownload = async (fileId: string, filename: string) => {
    if (!revisionData) return;
    setIsDownloading(true);
    try {
      const { url } = await api.getRevisionDownloadUrl(revisionData.revision.id, fileId) as { url: string; filename: string };
      triggerDownload(url, filename);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '下载失败。';
      setError(msg);
    } finally {
      setIsDownloading(false);
    }
  };

  // --- Reset to input state ---
  const handleNewRevision = () => {
    setRevisionData(null);
    setError(null);
    setFiles([]);
    setInstructions('');
    setWordsByFile(new Map());
  };

  // --- Loading ---
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-red-700" />
      </div>
    );
  }

  // --- Current state ---
  const status = revisionData?.revision?.status;
  const isActive = status === 'processing';
  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';
  const showInput = !revisionData || isFailed;

  // =======================================================================
  // RENDER
  // =======================================================================
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">文章修改</h1>
          <p className="mt-1 text-sm text-gray-500">
            上传需要修改的文章，输入修改要求，AI 将根据您的要求进行修改。
          </p>
        </div>
        <button
          onClick={() => navigate('/dashboard/tasks?tab=revisions')}
          className="text-sm text-gray-500 hover:text-red-700 transition-colors whitespace-nowrap mt-1"
        >
          查看修改历史 &rarr;
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
      {/* STATE: Processing */}
      {/* ================================================================= */}
      {isActive && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-red-700 mx-auto" />
          <h2 className="text-lg font-semibold text-gray-900">正在修改您的文章</h2>
          <p className="text-sm text-gray-500">
            AI 正在根据您的要求进行修改，请耐心等待...
          </p>
          <p className="text-xs text-gray-400">
            页面会自动刷新状态，请勿关闭此页面
          </p>
        </div>
      )}

      {/* ================================================================= */}
      {/* STATE: Completed */}
      {/* ================================================================= */}
      {isCompleted && revisionData && (
        <div className="space-y-4">
          {/* Success header */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800">修改完成</p>
              {revisionData.revision.word_count && (
                <p className="text-xs text-green-600 mt-0.5">
                  修改后字数：{revisionData.revision.word_count.toLocaleString()} 词
                </p>
              )}
            </div>
          </div>

          {/* Result text preview */}
          {revisionData.revision.result_text && (
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="text-sm font-medium text-gray-700">修改结果预览</h3>
              </div>
              <div className="p-4 max-h-96 overflow-y-auto">
                <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">
                  {revisionData.revision.result_text}
                </pre>
              </div>
            </div>
          )}

          {/* Download + New revision buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            {revisionData.files
              .filter(f => f.category === 'revision_output')
              .map(file => (
                <button
                  key={file.id}
                  onClick={() => handleDownload(file.id, file.original_name)}
                  disabled={isDownloading}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-700 text-white text-sm font-medium rounded-md hover:bg-red-800 disabled:opacity-50 transition-colors"
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  下载 Word 文档
                </button>
              ))}
            <button
              onClick={handleNewRevision}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              开始新的修改
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STATE: Failed */}
      {/* ================================================================= */}
      {isFailed && revisionData && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-800">修改失败</p>
              <p className="text-sm text-red-600 mt-1">
                {revisionData.revision.failure_reason || '处理过程中发生错误。'}
              </p>
              <p className="text-xs text-red-500 mt-2">积分已自动退还到您的账户。</p>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STATE: Input (show when no active revision or after failure) */}
      {/* ================================================================= */}
      {showInput && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
          {/* File upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              上传文章
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
              <p className="text-xs text-amber-600 mt-1">
                .doc（老 Word 二进制格式）暂不支持，请另存为 .docx 或 PDF。
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

            {/* File list */}
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

          {/* Instructions textarea */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              修改要求
            </label>
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="请描述您希望如何修改文章，例如：调整第二段的论证逻辑，增加更多数据支持..."
              rows={6}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-700 focus:border-transparent resize-none"
            />
          </div>

          {/* 预估卡片 + 计费提示 */}
          <div className="space-y-2">
            {files.length > 0 && (
              <div className={`rounded-md border p-3 text-sm ${
                isInsufficient
                  ? 'border-red-200 bg-red-50'
                  : 'border-gray-200 bg-gray-50'
              }`}>
                <div className="flex items-start gap-2">
                  <Sparkles className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                    isInsufficient ? 'text-red-600' : 'text-gray-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    {isEstimating ? (
                      <p className="text-gray-600">正在估算字数...</p>
                    ) : (
                      <>
                        <p className={isInsufficient ? 'text-red-700' : 'text-gray-700'}>
                          预估字数 <span className="font-semibold">{estimatedWords.toLocaleString()}</span> · 预估冻结 <span className="font-semibold">{estimatedAmount.toLocaleString()}</span> 积分
                        </p>
                        {isInsufficient ? (
                          <p className="text-xs text-red-600 mt-1">
                            您当前余额 {(balance ?? 0).toLocaleString()} 积分不足，请先{' '}
                            <button
                              type="button"
                              onClick={() => navigate('/dashboard/recharge')}
                              className="underline hover:text-red-800"
                            >
                              去充值
                            </button>
                            。
                          </p>
                        ) : (
                          <p className="text-xs text-gray-500 mt-1">
                            按修改后实际字数精确计费，多余冻结将自动退回
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
            <p className="text-xs text-gray-400">
              <FileText className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
              详细计费规则见首页常见问题
            </p>
          </div>

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || files.length === 0 || !instructions.trim() || isEstimating || isInsufficient}
            className="w-full py-2.5 bg-red-700 text-white text-sm font-medium rounded-md hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在提交...
              </>
            ) : isEstimating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在估算字数...
              </>
            ) : (
              '开始修改'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
