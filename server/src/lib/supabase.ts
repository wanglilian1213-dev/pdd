import { createClient } from '@supabase/supabase-js';
import { env } from './runtimeEnv';

export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

export function createUserClient(token: string) {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
