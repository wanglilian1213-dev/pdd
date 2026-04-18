import { supabase } from './supabase';
import { getFrontendEnv } from './frontendEnv';
import { parseApiResponse } from './httpResponse';

const API_BASE = getFrontendEnv().apiBaseUrl;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('未登录');
  }
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  return parseApiResponse<T>(res, '请求失败');
}

export const api = {
  // User
  initUser: () => request('/api/user/init', { method: 'POST' }),
  getProfile: () => request<any>('/api/user/profile'),

  // Recharge
  redeemCode: (code: string) => request<any>('/api/recharge/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }),
  getRechargeHistory: (limit = 20, offset = 0) =>
    request<any>(`/api/recharge/history?limit=${limit}&offset=${offset}`),

  // Task
  createTask: async (files: File[], title: string, specialRequirements: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('未登录');

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    formData.append('title', title);
    formData.append('specialRequirements', specialRequirements);

    const res = await fetch(`${API_BASE}/api/task/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: formData,
    });
    return parseApiResponse<any>(res, '创建任务失败');
  },
  getCurrentTask: () => request<any>('/api/task/current'),
  getTask: (id: string) => request<any>(`/api/task/${id}`),
  getTaskList: (status?: string, limit = 20, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.set('status', status);
    return request<any>(`/api/task/list?${params}`);
  },
  regenerateOutline: (taskId: string, editInstruction: string) =>
    request<any>(`/api/task/${taskId}/outline/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ editInstruction }),
    }),
  confirmOutline: (taskId: string) =>
    request<any>(`/api/task/${taskId}/outline/confirm`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  discardTask: (taskId: string) =>
    request<any>(`/api/task/${taskId}/discard`, { method: 'POST' }),
  startHumanize: (taskId: string) =>
    request<any>(`/api/task/${taskId}/humanize`, { method: 'POST' }),
  // 用户主动 dismiss 一个降 AI 任务（点"完成并创建新任务"）
  // 把所有 humanize_jobs 标记为 acknowledged=true，下次切回工作台不再恢复 step 7
  acknowledgeHumanize: (taskId: string) =>
    request<{ success: boolean }>(`/api/task/${taskId}/acknowledge-humanize`, {
      method: 'POST',
    }),
  getDownloadUrl: (taskId: string, fileId: string) =>
    request<any>(`/api/task/${taskId}/file/${fileId}/download`),

  // Revision
  createRevision: async (files: File[], instructions: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('未登录');

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    formData.append('instructions', instructions);

    const res = await fetch(`${API_BASE}/api/revision/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: formData,
    });
    return parseApiResponse<any>(res, '创建修改请求失败');
  },
  // 增量预估单文件字数和金额。
  // 前端选完文件就实时调一次，把 words 累加到本地 Map<File, words>。
  // 删除文件时前端直接从 Map 移除，不发请求。
  estimateRevisionFile: async (file: File) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('未登录');

    const fd = new FormData();
    fd.append('file', file);

    const res = await fetch(`${API_BASE}/api/revision/estimate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: fd,
    });
    return parseApiResponse<{ filename: string; words: number; pricePerWord: number }>(
      res,
      '预估失败',
    );
  },
  // 多文件精准预估：调 GPT-5.4 article_detection 识别主文章 +
  // 按 ceil(主文章字数 × 1.2) + 参考材料数 × 50 + 图片数 × 100 公式算冻结金额。
  // 前端在文件列表停止变化 1.5 秒后防抖调用，给用户展示「主文章: xxx · 实际冻结 X 积分」。
  // GPT 失败时后端会自动 fallback 到启发式（docx 字数最大 → 非图片字数最大），不会抛错。
  estimateRevisionPrecise: async (files: File[]) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('未登录');

    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));

    const res = await fetch(`${API_BASE}/api/revision/estimate-precise`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: fd,
    });
    return parseApiResponse<{
      mainArticleFilenames: string[];
      rawTotalWords: number;
      preciseFrozenWords: number;
      preciseFrozenAmount: number;
      pricePerWord: number;
      breakdown: { mainArticleWords: number; referenceCount: number; imageCount: number };
    }>(res, '精准预估失败');
  },
  getRevisionCurrent: () => request<any>('/api/revision/current'),
  getRevision: (id: string) => request<any>(`/api/revision/${id}`),
  getRevisionList: (limit = 20, offset = 0) =>
    request<any>(`/api/revision/list?limit=${limit}&offset=${offset}`),
  getRevisionDownloadUrl: (revisionId: string, fileId: string) =>
    request<any>(`/api/revision/${revisionId}/file/${fileId}/download`),

  // Scoring (文章评审)
  // 注意：2026-04-16 后端改成了异步化
  //   - 本接口只做 multer 收文件 + 上传 Storage + INSERT initializing 记录 + 返回，秒级响应
  //   - pdf-parse 解析 + 冻结积分由后端 prepareScoring 在后台跑
  //   - 前端拿到 { id, status: 'initializing' } 后立即进轮询
  createScoring: async (files: File[]) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('未登录');

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    // 60 秒硬超时。超了主动 abort，给用户明确中文错误，不让浏览器透传 "Failed to fetch"。
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
      const res = await fetch(`${API_BASE}/api/scoring/create`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        body: formData,
        signal: controller.signal,
      });
      return await parseApiResponse<{ id: string; status: string } & Record<string, unknown>>(
        res,
        '创建评审请求失败',
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('上传超时（60 秒），请检查网络或文件大小后重试。');
      }
      if (err instanceof TypeError && /fetch/i.test(err.message)) {
        throw new Error('上传失败：网络不稳定或文件过大，请重试。');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  },
  getScoringCurrent: () => request<any>('/api/scoring/current'),
  getScoring: (id: string) => request<any>(`/api/scoring/${id}`),
  getScoringList: (limit = 20, offset = 0) =>
    request<any>(`/api/scoring/list?limit=${limit}&offset=${offset}`),
  getScoringReportDownloadUrl: (scoringId: string, fileId: string) =>
    request<any>(`/api/scoring/${scoringId}/file/${fileId}/download`),

  // AI Detection (检测 AI)
  // 前端选文件后立即调 estimate 显示「预估 N 积分」；不扣积分不入库。
  estimateAiDetection: async (file: File) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('未登录');

    const fd = new FormData();
    fd.append('file', file);

    const res = await fetch(`${API_BASE}/api/ai-detection/estimate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: fd,
    });
    return parseApiResponse<{
      filename: string;
      words: number;
      pricePerWord: number;
      estimatedAmount: number;
      tooShort: boolean;
      tooLong: boolean;
      isScannedPdf: boolean;
      isImage: boolean;
    }>(res, '预估失败');
  },
  createAiDetection: async (file: File) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('未登录');

    const formData = new FormData();
    formData.append('files', file);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${API_BASE}/api/ai-detection/create`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        body: formData,
        signal: controller.signal,
      });
      return await parseApiResponse<{ id: string; status: string } & Record<string, unknown>>(
        res,
        '创建检测请求失败',
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('上传超时（60 秒），请检查网络或文件大小后重试。');
      }
      if (err instanceof TypeError && /fetch/i.test(err.message)) {
        throw new Error('上传失败：网络不稳定或文件过大，请重试。');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  },
  getAiDetectionCurrent: () => request<any>('/api/ai-detection/current'),
  getAiDetection: (id: string) => request<any>(`/api/ai-detection/${id}`),
  getAiDetectionList: (limit = 20, offset = 0) =>
    request<any>(`/api/ai-detection/list?limit=${limit}&offset=${offset}`),

  // Standalone Humanize (独立降 AI)
  estimateStandaloneHumanize: async (file: File) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('未登录');

    const fd = new FormData();
    fd.append('file', file);

    const res = await fetch(`${API_BASE}/api/standalone-humanize/estimate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: fd,
    });
    return parseApiResponse<{
      filename: string;
      words: number;
      pricePerWord: number;
      estimatedAmount: number;
      tooShort: boolean;
      tooLong: boolean;
      isScannedPdf: boolean;
      isImage: boolean;
    }>(res, '预估失败');
  },
  createStandaloneHumanize: async (file: File) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('未登录');

    const formData = new FormData();
    formData.append('files', file);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${API_BASE}/api/standalone-humanize/create`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        body: formData,
        signal: controller.signal,
      });
      return await parseApiResponse<{ id: string; status: string } & Record<string, unknown>>(
        res,
        '创建降 AI 请求失败',
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('上传超时（60 秒），请检查网络或文件大小后重试。');
      }
      if (err instanceof TypeError && /fetch/i.test(err.message)) {
        throw new Error('上传失败：网络不稳定或文件过大，请重试。');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  },
  getStandaloneHumanizeCurrent: () => request<any>('/api/standalone-humanize/current'),
  getStandaloneHumanize: (id: string) => request<any>(`/api/standalone-humanize/${id}`),
  getStandaloneHumanizeList: (limit = 20, offset = 0) =>
    request<any>(`/api/standalone-humanize/list?limit=${limit}&offset=${offset}`),
  getStandaloneHumanizeDownloadUrl: (humanizationId: string, fileId: string) =>
    request<any>(`/api/standalone-humanize/${humanizationId}/file/${fileId}/download`),
  acknowledgeStandaloneHumanize: (humanizationId: string) =>
    request<{ id: string }>(`/api/standalone-humanize/${humanizationId}/acknowledge`, {
      method: 'POST',
    }),

  // Chat
  sendChatMessage: (message: string, history: Array<{ role: string; content: string }>) =>
    request<{ reply: string; remainingToday: number }>('/api/chat/message', {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    }),
};
