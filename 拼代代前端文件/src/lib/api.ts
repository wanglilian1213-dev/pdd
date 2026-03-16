import { supabase } from './supabase';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

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
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || '请求失败');
  }
  return json.data;
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
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '创建任务失败');
    return json.data;
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
  confirmOutline: (taskId: string, targetWords?: number, citationStyle?: string) =>
    request<any>(`/api/task/${taskId}/outline/confirm`, {
      method: 'POST',
      body: JSON.stringify({ targetWords, citationStyle }),
    }),
  startHumanize: (taskId: string) =>
    request<any>(`/api/task/${taskId}/humanize`, { method: 'POST' }),
  getDownloadUrl: (taskId: string, fileId: string) =>
    request<any>(`/api/task/${taskId}/file/${fileId}/download`),
};
