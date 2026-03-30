import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontendEnv } from './frontendEnv';

test('parseFrontendEnv returns frontend config when required vars exist', () => {
  const env = parseFrontendEnv({
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon-key',
    VITE_API_BASE_URL: 'https://api.example.com',
  } as unknown as ImportMetaEnv);

  assert.deepEqual(env, {
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-key',
    apiBaseUrl: 'https://api.example.com',
  });
});

test('parseFrontendEnv throws when VITE_SUPABASE_URL is missing', () => {
  assert.throws(
    () =>
      parseFrontendEnv({
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_ANON_KEY: 'anon-key',
        VITE_API_BASE_URL: 'https://api.example.com',
      } as unknown as ImportMetaEnv),
    /VITE_SUPABASE_URL/,
  );
});

test('parseFrontendEnv throws when VITE_SUPABASE_ANON_KEY is missing', () => {
  assert.throws(
    () =>
      parseFrontendEnv({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_ANON_KEY: '',
        VITE_API_BASE_URL: 'https://api.example.com',
      } as unknown as ImportMetaEnv),
    /VITE_SUPABASE_ANON_KEY/,
  );
});
