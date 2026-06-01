import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from './env';

function buildRawEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    OPENAI_API_KEY: 'openai-key',
    OPENAI_MODEL: 'gpt-5.5',
    ALLOWED_ORIGINS: 'https://pindaidai.uk,http://localhost:3000',
    OPS_WHITELIST_EMAILS: 'ops@example.com',
    PORT: '3001',
    NODE_ENV: 'test',
    ...overrides,
  };
}

test('parseEnv accepts OPENAI_MODEL=gpt-5.5 without legacy model config', () => {
  const env = parseEnv(buildRawEnv());

  assert.equal(env.openaiModel, 'gpt-5.5');
  assert.equal(env.stealthwriterBaseUrl, 'https://stealthwriter.ai');
  assert.deepEqual(env.allowedOrigins, ['https://pindaidai.uk', 'http://localhost:3000']);
  assert.deepEqual(env.opsWhitelistEmails, ['ops@example.com']);
});

test('parseEnv throws when OPENAI_MODEL is missing', () => {
  assert.throws(
    () => parseEnv(buildRawEnv({ OPENAI_MODEL: '' })),
    /缺少环境变量 OPENAI_MODEL/,
  );
});

test('parseEnv throws when OPENAI_MODEL is not allowed', () => {
  const previousModel = 'gpt-' + '5.4';
  assert.throws(
    () => parseEnv(buildRawEnv({ OPENAI_MODEL: previousModel })),
    /OPENAI_MODEL 只能是 gpt-5\.5/,
  );
});

test('parseEnv throws when ALLOWED_ORIGINS is missing', () => {
  assert.throws(
    () => parseEnv(buildRawEnv({ ALLOWED_ORIGINS: '' })),
    /缺少环境变量 ALLOWED_ORIGINS/,
  );
});
