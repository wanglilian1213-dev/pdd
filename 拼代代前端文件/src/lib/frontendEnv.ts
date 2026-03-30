export interface FrontendEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
}

function readRequired(
  rawEnv: Partial<Record<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY', string>>,
  key: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY',
) {
  const value = rawEnv[key]?.trim();
  if (!value) {
    throw new Error(`缺少前端环境变量 ${key}`);
  }
  return value;
}

export function parseFrontendEnv(rawEnv: ImportMetaEnv): FrontendEnv {
  const env = rawEnv as ImportMetaEnv & {
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
    VITE_API_BASE_URL?: string;
  };

  return {
    supabaseUrl: readRequired(env, 'VITE_SUPABASE_URL'),
    supabaseAnonKey: readRequired(env, 'VITE_SUPABASE_ANON_KEY'),
    apiBaseUrl: env.VITE_API_BASE_URL?.trim() || 'http://localhost:3001',
  };
}

let cachedFrontendEnv: FrontendEnv | null = null;

export function getFrontendEnv() {
  if (!cachedFrontendEnv) {
    cachedFrontendEnv = parseFrontendEnv(import.meta.env);
  }
  return cachedFrontendEnv;
}
