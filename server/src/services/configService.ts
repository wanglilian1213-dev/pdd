import { supabaseAdmin } from '../lib/supabase';

export async function getConfig(key: string): Promise<any> {
  const { data } = await supabaseAdmin
    .from('system_config')
    .select('value')
    .eq('key', key)
    .single();
  return data?.value ?? null;
}

export async function getAllConfig() {
  const { data } = await supabaseAdmin
    .from('system_config')
    .select('key, value, updated_at');
  return data || [];
}

export async function setConfig(key: string, value: any, updatedBy: string) {
  const { error } = await supabaseAdmin
    .from('system_config')
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    });
  if (error) throw error;
}
