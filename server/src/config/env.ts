const allowedOpenAIModels = ['gpt-5.4'] as const;

type AllowedOpenAIModel = (typeof allowedOpenAIModels)[number];

export interface Env {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  openaiApiKey: string;
  openaiModel: AllowedOpenAIModel;
  undetectableApiKey: string;
  opsWhitelistEmails: string[];
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

export function parseEnv(rawEnv: NodeJS.ProcessEnv): Env {
  return {
    supabaseUrl: readRequired(rawEnv, 'SUPABASE_URL'),
    supabaseAnonKey: readRequired(rawEnv, 'SUPABASE_ANON_KEY'),
    supabaseServiceRoleKey: readRequired(rawEnv, 'SUPABASE_SERVICE_ROLE_KEY'),
    openaiApiKey: readRequired(rawEnv, 'OPENAI_API_KEY'),
    openaiModel: readOpenAIModel(rawEnv),
    undetectableApiKey: readRequired(rawEnv, 'UNDETECTABLE_API_KEY'),
    opsWhitelistEmails: (rawEnv.OPS_WHITELIST_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    port: parseInt(rawEnv.PORT || '3001', 10),
    nodeEnv: rawEnv.NODE_ENV || 'development',
  };
}
