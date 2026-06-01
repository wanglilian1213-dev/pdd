import { createClient } from '@supabase/supabase-js';
import type { BrowserContext, Page } from 'playwright';
import {
  createPersistentBrowserContext,
  ensureStealthwriterHome,
  extractStealthwriterSession,
  loginToStealthwriter,
  seedStealthwriterBrowserSession,
  type WorkerBrowserConfig,
  type WorkerCredentials,
  type WorkerSessionPayload,
} from './browserSession';

export interface WorkerEnv extends WorkerBrowserConfig, WorkerCredentials {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

export interface RefreshSessionResult {
  session: WorkerSessionPayload;
  loginState: 'reused' | 'relogged';
  refreshedAt: string;
}

export interface HealthStatus {
  ok: boolean;
  profileDir: string;
  lastRefreshAt: string | null;
  hasContext: boolean;
}

export function isSessionExpiringSoon(
  expiresAt: string | null,
  nowMs = Date.now(),
  minRemainingMs = 12 * 60 * 60 * 1000,
): boolean {
  if (!expiresAt) return true;
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs - nowMs <= minRemainingMs;
}

export class StealthwriterWorkerRuntime {
  private readonly supabase;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private lastRefreshAt: string | null = null;

  constructor(private readonly env: WorkerEnv) {
    this.supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  }

  private async ensureBrowser() {
    if (this.context && this.page) {
      return { context: this.context, page: this.page };
    }

    this.context = await createPersistentBrowserContext({
      baseUrl: this.env.baseUrl,
      profileDir: this.env.profileDir,
      headless: this.env.headless,
    });

    this.page = this.context.pages()[0] || await this.context.newPage();
    await ensureStealthwriterHome(this.page, this.env.baseUrl);

    return { context: this.context, page: this.page };
  }

  private async persistSession(session: WorkerSessionPayload) {
    const { error } = await this.supabase.rpc('replace_stealthwriter_session', {
      p_session_token: session.sessionToken,
      p_cookie_header: session.cookieHeader,
      p_fp: session.fp,
      p_expires_at: session.expiresAt,
      p_notes: session.notes,
    });

    if (error) {
      throw new Error(`Supabase 写入 StealthWriter 会话失败: ${error.message}`);
    }
  }

  private async loadActiveSession(): Promise<WorkerSessionPayload | null> {
    const { data, error } = await this.supabase
      .from('stealthwriter_session')
      .select('session_token, cookie_header, fp, expires_at, notes')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Supabase 读取 StealthWriter 会话失败: ${error.message}`);
    }

    if (!data?.cookie_header || !data?.fp) {
      return null;
    }

    return {
      sessionToken: typeof data.session_token === 'string' ? data.session_token : null,
      cookieHeader: data.cookie_header,
      fp: data.fp,
      expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
      notes: typeof data.notes === 'string' ? data.notes : 'stored_session',
    };
  }

  async refreshSession(reason = 'manual_refresh'): Promise<RefreshSessionResult> {
    const { context, page } = await this.ensureBrowser();
    const storedSession = await this.loadActiveSession();
    if (storedSession) {
      await seedStealthwriterBrowserSession(page, context, this.env.baseUrl, storedSession);
    }

    const loginState = await loginToStealthwriter(page, this.env.baseUrl, {
      email: this.env.email,
      password: this.env.password,
    });

    const extracted = await extractStealthwriterSession(page, context);
    const session = {
      ...extracted,
      notes: `${reason}:${loginState}`,
    };

    await this.persistSession(session);
    this.lastRefreshAt = new Date().toISOString();

    return {
      session,
      loginState,
      refreshedAt: this.lastRefreshAt,
    };
  }

  async health(): Promise<HealthStatus> {
    return {
      ok: true,
      profileDir: this.env.profileDir,
      lastRefreshAt: this.lastRefreshAt,
      hasContext: Boolean(this.context && this.page),
    };
  }
}
