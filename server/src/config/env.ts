const allowedOpenAIModels = ['gpt-5.4'] as const;

type AllowedOpenAIModel = (typeof allowedOpenAIModels)[number];

export interface Env {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  openaiApiKey: string;
  openaiBaseUrl: string | undefined;
  openaiModel: AllowedOpenAIModel;
  undetectableApiKey: string;
  allowedOrigins: string[];
  opsWhitelistEmails: string[];
  configCacheTtlMs: number;
  sentryDsn: string | null;
  port: number;
  nodeEnv: string;
}

function readRequired(rawEnv: NodeJS.ProcessEnv, key: string) {
  const value = rawEnv[key]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量 ${key}`);
  }
  return value;
}

function readOpenAIModel(rawEnv: NodeJS.ProcessEnv): AllowedOpenAIModel {
  const value = readRequired(rawEnv, 'OPENAI_MODEL');

  if (!allowedOpenAIModels.includes(value as AllowedOpenAIModel)) {
    throw new Error(`OPENAI_MODEL 只能是 gpt-5.4，当前值：${value}`);
  }

  return value as AllowedOpenAIModel;
}

function readAllowedOrigins(rawEnv: NodeJS.ProcessEnv) {
  const value = readRequired(rawEnv, 'ALLOWED_ORIGINS');
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('ALLOWED_ORIGINS 至少要包含一个前端地址');
  }

  return origins;
}

function readPositiveInteger(rawEnv: NodeJS.ProcessEnv, key: string, fallback: number) {
  const rawValue = rawEnv[key]?.trim();
  if (!rawValue) return fallback;

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} 必须是大于 0 的整数`);
  }

  return parsed;
}

export function parseEnv(rawEnv: NodeJS.ProcessEnv): Env {
  return {
    supabaseUrl: readRequired(rawEnv, 'SUPABASE_URL'),
    supabaseAnonKey: readRequired(rawEnv, 'SUPABASE_ANON_KEY'),
    supabaseServiceRoleKey: readRequired(rawEnv, 'SUPABASE_SERVICE_ROLE_KEY'),
    openaiApiKey: readRequired(rawEnv, 'OPENAI_API_KEY'),
    openaiBaseUrl: rawEnv.OPENAI_BASE_URL?.trim() || undefined,
    openaiModel: readOpenAIModel(rawEnv),
    undetectableApiKey: readRequired(rawEnv, 'UNDETECTABLE_API_KEY'),
    allowedOrigins: readAllowedOrigins(rawEnv),
    opsWhitelistEmails: (rawEnv.OPS_WHITELIST_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    configCacheTtlMs: readPositiveInteger(rawEnv, 'CONFIG_CACHE_TTL_MS', 60_000),
    sentryDsn: rawEnv.SENTRY_DSN?.trim() || null,
    port: parseInt(rawEnv.PORT || '3001', 10),
    nodeEnv: rawEnv.NODE_ENV || 'development',
  };
}
