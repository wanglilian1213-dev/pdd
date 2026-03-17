import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { validateConfigValue } from './opsService';

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
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('system_config')
    .select('key')
    .eq('key', key)
    .maybeSingle();

  if (existingError) {
    throw new AppError(500, '读取配置失败，请稍后重试。', existingError.message);
  }

  if (!existing) {
    throw new AppError(400, '配置项不存在，不能更新。');
  }

  const normalizedValue = validateConfigValue(key, value);

  const { error } = await supabaseAdmin
    .from('system_config')
    .upsert({
      key,
      value: normalizedValue,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    });
  if (error) throw error;
}
