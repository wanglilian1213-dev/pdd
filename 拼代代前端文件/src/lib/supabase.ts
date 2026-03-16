import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://rjnfctvauewstngqbvrz.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqbmZjdHZhdWV3c3RuZ3FidnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2Njc5NDEsImV4cCI6MjA4OTI0Mzk0MX0.hko2P3G8xAqweNifjWxwOJzFfj2UaApPFROoEVPkDQE';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
