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
  getRevisionCurrent: () => request<any>('/api/revision/current'),
  getRevision: (id: string) => request<any>(`/api/revision/${id}`),
  getRevisionList: (limit = 20, offset = 0) =>
    request<any>(`/api/revision/list?limit=${limit}&offset=${offset}`),
  getRevisionDownloadUrl: (revisionId: string, fileId: string) =>
    request<any>(`/api/revision/${revisionId}/file/${fileId}/download`),

  // Scoring (文章评审)
  createScoring: async (files: File[]) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('未登录');

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    const res = await fetch(`${API_BASE}/api/scoring/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: formData,
    });
    return parseApiResponse<any>(res, '创建评审请求失败');
  },
  getScoringCurrent: () => request<any>('/api/scoring/current'),
  getScoring: (id: string) => request<any>(`/api/scoring/${id}`),
  getScoringList: (limit = 20, offset = 0) =>
    request<any>(`/api/scoring/list?limit=${limit}&offset=${offset}`),
  getScoringReportDownloadUrl: (scoringId: string, fileId: string) =>
    request<any>(`/api/scoring/${scoringId}/file/${fileId}/download`),

  // Chat
  sendChatMessage: (message: string, history: Array<{ role: string; content: string }>) =>
    request<{ reply: string; remainingToday: number }>('/api/chat/message', {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    }),
};
