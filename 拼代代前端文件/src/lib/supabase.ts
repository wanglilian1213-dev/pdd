import { createClient } from '@supabase/supabase-js';
import { getFrontendEnv } from './frontendEnv';

const frontendEnv = getFrontendEnv();

export const supabase = createClient(frontendEnv.supabaseUrl, frontendEnv.supabaseAnonKey);
