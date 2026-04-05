import React, { useState, useRef, useCallback, useEffect } from 'react';
import { UploadCloud, FileText, Loader2, CheckCircle2, AlertCircle, Download, X, File, RefreshCw } from 'lucide-react';
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

  const pollRef = useRef<PollState>({ timeoutId: null, startedAt: 0, attempt: 0 });
  const { refreshBalance } = useBalance();

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

  // --- File handlers ---
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

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
    setFiles(prev => [...prev, ...droppedFiles]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  // --- Submit ---
  const handleSubmit = async () => {
    if (files.length === 0 || !instructions.trim()) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await api.createRevision(files, instructions.trim()) as any;
      setRevisionData({ revision: result, files: [] });
      setFiles([]);
      setInstructions('');
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">文章修改</h1>
        <p className="mt-1 text-sm text-gray-500">
          上传需要修改的文章，输入修改要求，AI 将根据您的要求进行修改。
        </p>
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
                支持 Word、PDF、图片，最多 10 个文件，每个不超过 20MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".docx,.doc,.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff,.tif,.heic,.heif"
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

          {/* Cost hint */}
          <p className="text-xs text-gray-400">
            <FileText className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
            每 1000 字收费 250 积分，按文章字数计费，不足 1000 字按 1000 字计
          </p>

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || files.length === 0 || !instructions.trim()}
            className="w-full py-2.5 bg-red-700 text-white text-sm font-medium rounded-md hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在提交...
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
