import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { FileText, FileEdit, Download, Clock, CheckCircle2, AlertCircle, RefreshCw, Search, Filter, Loader2, Info } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { api } from '../../lib/api';
import { normalizeTaskFiles, pickPrimaryDownloadFile } from '../../lib/taskFiles';
import { triggerDownload } from '../../lib/downloadFile';
import { formatDate } from '../../lib/utils';

interface TaskItem {
  id: string;
  title: string;
  paper_title?: string;
  research_question?: string;
  status: string;
  stage: string;
  target_words: number;
  frozen_credits: number;
  created_at: string;
  completed_at: string | null;
}

interface RevisionItem {
  id: string;
  instructions: string;
  status: 'processing' | 'completed' | 'failed';
  word_count: number | null;
  frozen_credits: number;
  failure_reason: string | null;
  created_at: string;
}

export default function Tasks() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Tab state — supports ?tab=revisions from Revision page link
  const [activeTab, setActiveTab] = useState<'tasks' | 'revisions'>(
    searchParams.get('tab') === 'revisions' ? 'revisions' : 'tasks',
  );

  // ── Task state ──
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [allTasks, setAllTasks] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // ── Revision state ──
  const [revisionSearch, setRevisionSearch] = useState('');
  const [revisionStatusFilter, setRevisionStatusFilter] = useState('all');
  const [allRevisions, setAllRevisions] = useState<RevisionItem[]>([]);
  const [revisionTotal, setRevisionTotal] = useState(0);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [revisionDownloadingId, setRevisionDownloadingId] = useState<string | null>(null);

  // ── Fetch tasks ──
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusParam = statusFilter === 'all' ? undefined : statusFilter;
      const data = await api.getTaskList(statusParam);
      setAllTasks(data.tasks ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取任务列表失败';
      setError(message);
      setAllTasks([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  // ── Fetch revisions ──
  const fetchRevisions = useCallback(async () => {
    setRevisionLoading(true);
    setRevisionError(null);
    try {
      const data = await api.getRevisionList();
      setAllRevisions(data.revisions ?? []);
      setRevisionTotal(data.total ?? 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取修改记录失败';
      setRevisionError(message);
      setAllRevisions([]);
      setRevisionTotal(0);
    } finally {
      setRevisionLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'tasks') {
      fetchTasks();
    } else {
      fetchRevisions();
    }
  }, [activeTab, fetchTasks, fetchRevisions]);

  // ── Client-side filtering ──
  const tasks = allTasks.filter(task => {
    const term = searchTerm.toLowerCase();
    if (!term) return true;
    const shortId = task.id.slice(0, 8);
    const displayTitle = (task.paper_title || task.title || '').toLowerCase();
    return displayTitle.includes(term) ||
           task.title.toLowerCase().includes(term) ||
           task.id.toLowerCase().includes(term) ||
           shortId.toLowerCase().includes(term);
  });

  const revisions = allRevisions.filter(rev => {
    const matchStatus = revisionStatusFilter === 'all' || rev.status === revisionStatusFilter;
    if (!matchStatus) return false;
    const term = revisionSearch.toLowerCase();
    if (!term) return true;
    const shortId = rev.id.slice(0, 8);
    return rev.instructions.toLowerCase().includes(term) ||
           rev.id.toLowerCase().includes(term) ||
           shortId.toLowerCase().includes(term);
  });

  // ── Task download ──
  const handleDownload = async (taskId: string) => {
    setDownloadingId(taskId);
    try {
      const taskDetail = await api.getTask(taskId);
      const files = normalizeTaskFiles(taskDetail.files ?? taskDetail.task?.files ?? []);
      if (!files.length) {
        alert('该任务暂无可下载的文件');
        return;
      }
      const file = pickPrimaryDownloadFile(files);
      if (!file) {
        alert('该任务暂无主文稿可下载');
        return;
      }
      const { url } = await api.getDownloadUrl(taskId, file.id);
      triggerDownload(url, file.filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取下载链接失败';
      alert(message);
    } finally {
      setDownloadingId(null);
    }
  };

  // ── Revision download ──
  const handleRevisionDownload = async (revisionId: string) => {
    setRevisionDownloadingId(revisionId);
    try {
      const detail = await api.getRevision(revisionId);
      const outputFiles = (detail.files ?? []).filter(
        (f: { category: string }) => f.category === 'revision_output',
      );
      if (outputFiles.length === 0) {
        alert('该修改记录暂无可下载的文件');
        return;
      }
      const file = outputFiles[0];
      const { url } = await api.getRevisionDownloadUrl(revisionId, file.id);
      triggerDownload(url, file.original_name);
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取下载链接失败';
      alert(message);
    } finally {
      setRevisionDownloadingId(null);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed': return '已完成';
      case 'processing': return '处理中';
      case 'failed': return '失败';
      default: return '全部状态';
    }
  };

  const getTaskStatusLabel = (status: string) => {
    switch (status) {
      case 'completed': return '已交付';
      case 'processing': return '处理中';
      case 'failed': return '生成失败';
      default: return '全部状态';
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">我的任务</h1>
        <p className="text-sm text-gray-500 mt-1">查看历史生成记录与下载交付文件。</p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>历史写作文件保留 <strong>3 天</strong>，过期后系统会自动删除，请及时下载到本地。</span>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'tasks'
              ? 'border-red-700 text-red-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          写作任务
        </button>
        <button
          onClick={() => setActiveTab('revisions')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'revisions'
              ? 'border-red-700 text-red-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          文章修改
        </button>
      </div>

      {/* ════════════════════ 写作任务 Tab ════════════════════ */}
      {activeTab === 'tasks' && (
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle className="text-lg">任务列表</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="搜索任务ID或标题..."
                  className="pl-9 w-full sm:w-64 bg-white"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="bg-white gap-2">
                    <Filter className="h-4 w-4 text-gray-500" />
                    <span className="hidden sm:inline">{getTaskStatusLabel(statusFilter)}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setStatusFilter('all')}>全部状态</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter('completed')}>已交付</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter('processing')}>处理中</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter('failed')}>生成失败</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>加载中...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm text-red-600">{error}</p>
                <Button variant="outline" size="sm" onClick={fetchTasks} className="gap-2">
                  <RefreshCw className="w-3.5 h-3.5" /> 重试
                </Button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left text-gray-500 min-w-[800px]">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th scope="col" className="px-6 py-4 w-[40%]">任务信息</th>
                        <th scope="col" className="px-6 py-4 w-[15%]">状态</th>
                        <th scope="col" className="px-6 py-4 w-[20%]">创建时间</th>
                        <th scope="col" className="px-6 py-4 w-[10%]">消耗积分</th>
                        <th scope="col" className="px-6 py-4 w-[15%] text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                            没有找到匹配的任务记录
                          </td>
                        </tr>
                      ) : (
                        tasks.map((task) => {
                          const displayTitle = task.paper_title || task.title;
                          return (
                          <tr key={task.id} className="bg-white border-b border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-start gap-3">
                                <div className="bg-red-50 p-2 rounded-lg mt-0.5">
                                  <FileText className="w-4 h-4 text-red-700" />
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900 line-clamp-1 max-w-xs" title={displayTitle}>
                                    {displayTitle}
                                  </div>
                                  <div className="text-xs text-gray-400 mt-1 font-mono">{task.id.slice(0, 8)}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {task.status === 'completed' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> 已交付
                                </span>
                              )}
                              {task.status === 'processing' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                  <Clock className="w-3.5 h-3.5 animate-pulse" /> 处理中
                                </span>
                              )}
                              {task.status === 'failed' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                                  <AlertCircle className="w-3.5 h-3.5" /> 生成失败
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-gray-500 font-mono text-xs">
                              {task.created_at ? formatDate(task.created_at) : '-'}
                            </td>
                            <td className="px-6 py-4 font-medium text-gray-900">
                              {task.frozen_credits > 0 ? `-${task.frozen_credits}` : '-'}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {task.status === 'completed' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-2"
                                  disabled={downloadingId === task.id}
                                  onClick={() => handleDownload(task.id)}
                                >
                                  {downloadingId === task.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Download className="w-3.5 h-3.5" />
                                  )}
                                  下载
                                </Button>
                              )}
                              {task.status === 'processing' && (
                                <Button variant="ghost" size="sm" disabled className="text-gray-400">
                                  等待中
                                </Button>
                              )}
                              {task.status === 'failed' && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="gap-2 bg-red-50 text-red-700 hover:bg-red-100"
                                  onClick={() => navigate('/dashboard/workspace')}
                                >
                                  <RefreshCw className="w-3.5 h-3.5" /> 重新处理
                                </Button>
                              )}
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-gray-100 bg-white gap-4">
                  <div className="text-sm text-gray-500">
                    显示 1 到 {tasks.length} 条，共 {total} 条记录
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button variant="outline" size="sm" disabled className="flex-1 sm:flex-none">上一页</Button>
                    <Button variant="outline" size="sm" disabled className="flex-1 sm:flex-none">下一页</Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ════════════════════ 文章修改 Tab ════════════════════ */}
      {activeTab === 'revisions' && (
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle className="text-lg">修改记录</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="搜索修改要求..."
                  className="pl-9 w-full sm:w-64 bg-white"
                  value={revisionSearch}
                  onChange={(e) => setRevisionSearch(e.target.value)}
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="bg-white gap-2">
                    <Filter className="h-4 w-4 text-gray-500" />
                    <span className="hidden sm:inline">{getStatusLabel(revisionStatusFilter)}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setRevisionStatusFilter('all')}>全部状态</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setRevisionStatusFilter('completed')}>已完成</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setRevisionStatusFilter('processing')}>处理中</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setRevisionStatusFilter('failed')}>失败</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {revisionLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>加载中...</span>
              </div>
            ) : revisionError ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm text-red-600">{revisionError}</p>
                <Button variant="outline" size="sm" onClick={fetchRevisions} className="gap-2">
                  <RefreshCw className="w-3.5 h-3.5" /> 重试
                </Button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left text-gray-500 min-w-[800px]">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th scope="col" className="px-6 py-4 w-[40%]">修改信息</th>
                        <th scope="col" className="px-6 py-4 w-[15%]">状态</th>
                        <th scope="col" className="px-6 py-4 w-[20%]">创建时间</th>
                        <th scope="col" className="px-6 py-4 w-[10%]">消耗积分</th>
                        <th scope="col" className="px-6 py-4 w-[15%] text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revisions.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                            没有找到匹配的修改记录
                          </td>
                        </tr>
                      ) : (
                        revisions.map((rev) => (
                          <tr key={rev.id} className="bg-white border-b border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-start gap-3">
                                <div className="bg-blue-50 p-2 rounded-lg mt-0.5">
                                  <FileEdit className="w-4 h-4 text-blue-700" />
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900 line-clamp-2 max-w-xs" title={rev.instructions}>
                                    {rev.instructions}
                                  </div>
                                  <div className="text-xs text-gray-400 mt-1 font-mono">
                                    {rev.id.slice(0, 8)}
                                    {rev.word_count != null && <span className="ml-2">{rev.word_count} 词</span>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {rev.status === 'completed' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> 已完成
                                </span>
                              )}
                              {rev.status === 'processing' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                  <Clock className="w-3.5 h-3.5 animate-pulse" /> 处理中
                                </span>
                              )}
                              {rev.status === 'failed' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                                  <AlertCircle className="w-3.5 h-3.5" /> 修改失败
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-gray-500 font-mono text-xs">
                              {rev.created_at ? formatDate(rev.created_at) : '-'}
                            </td>
                            <td className="px-6 py-4 font-medium text-gray-900">
                              {rev.frozen_credits > 0 ? `-${rev.frozen_credits}` : '-'}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {rev.status === 'completed' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-2"
                                  disabled={revisionDownloadingId === rev.id}
                                  onClick={() => handleRevisionDownload(rev.id)}
                                >
                                  {revisionDownloadingId === rev.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Download className="w-3.5 h-3.5" />
                                  )}
                                  下载
                                </Button>
                              )}
                              {rev.status === 'processing' && (
                                <Button variant="ghost" size="sm" disabled className="text-gray-400">
                                  等待中
                                </Button>
                              )}
                              {rev.status === 'failed' && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="gap-2 bg-red-50 text-red-700 hover:bg-red-100"
                                  onClick={() => navigate('/dashboard/revision')}
                                >
                                  <RefreshCw className="w-3.5 h-3.5" /> 重新修改
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-gray-100 bg-white gap-4">
                  <div className="text-sm text-gray-500">
                    显示 1 到 {revisions.length} 条，共 {revisionTotal} 条记录
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button variant="outline" size="sm" disabled className="flex-1 sm:flex-none">上一页</Button>
                    <Button variant="outline" size="sm" disabled className="flex-1 sm:flex-none">下一页</Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
