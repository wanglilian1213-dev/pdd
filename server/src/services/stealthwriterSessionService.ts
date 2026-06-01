import { env } from '../lib/runtimeEnv';
import { AppError } from '../lib/errors';
import { supabaseAdmin } from '../lib/supabase';

export interface StealthwriterSession {
  id: string;
  sessionToken: string | null;
  cookieHeader: string;
  fp: string;
  expiresAt: string | null;
  lastVerifiedAt: string | null;
  lastRefreshedAt: string | null;
  status: 'active' | 'expired' | 'refreshing' | 'broken';
  notes: string | null;
}

export interface ReplaceStealthwriterSessionInput {
  sessionToken?: string | null;
  cookieHeader: string;
  fp: string;
  expiresAt?: string | null;
  notes?: string | null;
}

interface RawStealthwriterSessionRow {
  id: string;
  session_token: string | null;
  cookie_header: string | null;
  fp: string | null;
  expires_at: string | null;
  last_verified_at: string | null;
  last_refreshed_at: string | null;
  status: StealthwriterSession['status'];
  notes: string | null;
}

interface StealthwriterSessionServiceDeps {
  loadActive: () => Promise<RawStealthwriterSessionRow | null>;
  replaceActive: (input: ReplaceStealthwriterSessionInput) => Promise<RawStealthwriterSessionRow>;
  updateActive: (payload: Record<string, unknown>) => Promise<void>;
  fetchImpl: typeof fetch;
}

interface SessionRefreshPolicy {
  minRemainingMs?: number;
  maxVerifiedAgeMs?: number;
}

function mapRow(row: RawStealthwriterSessionRow): StealthwriterSession {
  return {
    id: row.id,
    sessionToken: row.session_token || null,
    cookieHeader: row.cookie_header || '',
    fp: row.fp || '',
    expiresAt: row.expires_at || null,
    lastVerifiedAt: row.last_verified_at || null,
    lastRefreshedAt: row.last_refreshed_at || null,
    status: row.status,
    notes: row.notes || null,
  };
}

const defaultDeps: StealthwriterSessionServiceDeps = {
  loadActive: async () => {
    const { data, error } = await supabaseAdmin
      .from('stealthwriter_session')
      .select(
        'id, session_token, cookie_header, fp, expires_at, last_verified_at, last_refreshed_at, status, notes',
      )
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new AppError(500, '读取 StealthWriter 会话失败。', error.message);
    }

    return data as RawStealthwriterSessionRow | null;
  },
  replaceActive: async (input) => {
    const { data, error } = await supabaseAdmin.rpc('replace_stealthwriter_session', {
      p_session_token: input.sessionToken ?? null,
      p_cookie_header: input.cookieHeader,
      p_fp: input.fp,
      p_expires_at: input.expiresAt ?? null,
      p_notes: input.notes ?? null,
    });

    if (error || !data) {
      throw new AppError(500, '替换 StealthWriter 会话失败。', error?.message);
    }

    return data as RawStealthwriterSessionRow;
  },
  updateActive: async (payload) => {
    const { error } = await supabaseAdmin
      .from('stealthwriter_session')
      .update(payload)
      .eq('status', 'active');

    if (error) {
      throw new AppError(500, '更新 StealthWriter 会话失败。', error.message);
    }
  },
  fetchImpl: fetch,
};

export async function getActiveStealthwriterSession(
  deps: StealthwriterSessionServiceDeps = defaultDeps,
): Promise<StealthwriterSession | null> {
  const row = await deps.loadActive();
  return row ? mapRow(row) : null;
}

export async function replaceStealthwriterSession(
  input: ReplaceStealthwriterSessionInput,
  deps: StealthwriterSessionServiceDeps = defaultDeps,
): Promise<StealthwriterSession> {
  if (!input.cookieHeader.trim()) {
    throw new AppError(500, 'StealthWriter cookie_header 不能为空。');
  }
  if (!input.fp.trim()) {
    throw new AppError(500, 'StealthWriter fp 不能为空。');
  }

  const row = await deps.replaceActive(input);
  return mapRow(row);
}

export async function markStealthwriterSessionBroken(
  notes: string,
  deps: StealthwriterSessionServiceDeps = defaultDeps,
): Promise<void> {
  await deps.updateActive({
    status: 'broken',
    notes,
    updated_at: new Date().toISOString(),
  });
}

export async function touchStealthwriterSessionVerified(
  deps: StealthwriterSessionServiceDeps = defaultDeps,
): Promise<void> {
  await deps.updateActive({
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export function shouldRefreshStealthwriterSession(
  session: StealthwriterSession | null,
  nowMs = Date.now(),
  policy: SessionRefreshPolicy = {},
): boolean {
  const minRemainingMs = policy.minRemainingMs ?? 12 * 60 * 60 * 1000;
  const maxVerifiedAgeMs = policy.maxVerifiedAgeMs ?? 6 * 60 * 60 * 1000;

  if (!session) return true;
  if (session.status !== 'active') return true;

  if (session.expiresAt) {
    const expiresAtMs = Date.parse(session.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs - nowMs <= minRemainingMs) {
      return true;
    }
  }

  if (!session.lastVerifiedAt) return true;

  const lastVerifiedAtMs = Date.parse(session.lastVerifiedAt);
  if (!Number.isFinite(lastVerifiedAtMs)) return true;

  return nowMs - lastVerifiedAtMs >= maxVerifiedAgeMs;
}

export async function refreshStealthwriterSessionIfNeeded(
  deps: StealthwriterSessionServiceDeps = defaultDeps,
  nowMs = Date.now(),
  policy: SessionRefreshPolicy = {},
): Promise<StealthwriterSession | null> {
  const session = await getActiveStealthwriterSession(deps);
  if (!shouldRefreshStealthwriterSession(session, nowMs, policy)) {
    return session;
  }

  return refreshStealthwriterSessionFromWorker(deps);
}

export async function refreshStealthwriterSessionFromWorker(
  deps: StealthwriterSessionServiceDeps = defaultDeps,
): Promise<StealthwriterSession> {
  if (!env.stealthwriterWorkerUrl || !env.stealthwriterWorkerToken) {
    throw new AppError(500, 'StealthWriter worker 未配置。');
  }

  const response = await deps.fetchImpl(`${env.stealthwriterWorkerUrl.replace(/\/$/, '')}/refresh-session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.stealthwriterWorkerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'server_requested_refresh' }),
  });

  const data = await response.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'StealthWriter worker 刷新失败。';
    throw new AppError(500, message);
  }

  const session = (data.session ?? null) as Record<string, unknown> | null;
  if (!session || typeof session.cookieHeader !== 'string' || typeof session.fp !== 'string') {
    throw new AppError(500, 'StealthWriter worker 返回的会话结构无效。');
  }

  return replaceStealthwriterSession({
    sessionToken: typeof session.sessionToken === 'string' ? session.sessionToken : null,
    cookieHeader: session.cookieHeader,
    fp: session.fp,
    expiresAt: typeof session.expiresAt === 'string' ? session.expiresAt : null,
    notes: typeof session.notes === 'string' ? session.notes : 'worker_refresh',
  }, deps);
}
