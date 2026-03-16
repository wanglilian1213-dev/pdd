import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { FileText, Download, Clock, CheckCircle2, AlertCircle, RefreshCw, Search, Filter } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";

export default function Tasks() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  
  const allTasks = [
    {
      id: 'TASK-20260315-001',
      title: 'The Impact of Artificial Intelligence on Modern Supply Chain Management',
      status: 'completed',
      date: '2026-03-15 14:30',
      cost: 450,
      words: 2145,
    },
    {
      id: 'TASK-20260314-089',
      title: 'Marketing Strategy Analysis for Tesla in European Market',
      status: 'processing',
      date: '2026-03-14 09:15',
      cost: 380,
      words: 1800,
    },
    {
      id: 'TASK-20260312-042',
      title: 'A Review of Cognitive Behavioral Therapy Efficacy',
      status: 'failed',
      date: '2026-03-12 16:45',
      cost: 0,
      words: 0,
    },
    {
      id: 'TASK-20260310-112',
      title: 'The Role of Renewable Energy in Sustainable Development',
      status: 'completed',
      date: '2026-03-10 11:20',
      cost: 850, // Includes AI reduction
      words: 3200,
    },
  ];

  const tasks = allTasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          task.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusLabel = (status: string) => {
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
                  <span className="hidden sm:inline">{getStatusLabel(statusFilter)}</span>
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
                  tasks.map((task, i) => (
                    <tr key={i} className="bg-white border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-start gap-3">
                          <div className="bg-red-50 p-2 rounded-lg mt-0.5">
                            <FileText className="w-4 h-4 text-red-700" />
                          </div>
                          <div>
                            <div className="font-medium text-gray-900 line-clamp-1 max-w-xs" title={task.title}>
                              {task.title}
                            </div>
                            <div className="text-xs text-gray-400 mt-1 font-mono">{task.id}</div>
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
                        {task.date}
                      </td>
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {task.cost > 0 ? `-${task.cost}` : '-'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {task.status === 'completed' && (
                          <Button variant="outline" size="sm" className="gap-2">
                            <Download className="w-3.5 h-3.5" /> 下载
                          </Button>
                        )}
                        {task.status === 'processing' && (
                          <Button variant="ghost" size="sm" disabled className="text-gray-400">
                            等待中
                          </Button>
                        )}
                        {task.status === 'failed' && (
                          <Button variant="secondary" size="sm" className="gap-2 bg-red-50 text-red-700 hover:bg-red-100">
                            <RefreshCw className="w-3.5 h-3.5" /> 重新处理
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Placeholder */}
          <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-gray-100 bg-white gap-4">
            <div className="text-sm text-gray-500">
              显示 1 到 {tasks.length} 条，共 {tasks.length} 条记录
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" size="sm" disabled className="flex-1 sm:flex-none">上一页</Button>
              <Button variant="outline" size="sm" disabled className="flex-1 sm:flex-none">下一页</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
