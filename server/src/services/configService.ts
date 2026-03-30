import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { validateConfigValue } from './opsService';
import { env } from '../lib/runtimeEnv';

type ConfigRecord = { key: string; value: any; updated_at?: string };

interface ConfigCacheEntry<T> {
  value: T;
  expiresAt: number;
}

let now = () => Date.now();
const configByKeyCache = new Map<string, ConfigCacheEntry<any>>();
let allConfigCache: ConfigCacheEntry<ConfigRecord[]> | null = null;

function isValid<T>(entry: ConfigCacheEntry<T> | null | undefined): entry is ConfigCacheEntry<T> {
  return entry !== null && entry !== undefined && entry.expiresAt > now();
}

function setCacheValue<T>(value: T): ConfigCacheEntry<T> {
  return {
    value,
    expiresAt: now() + env.configCacheTtlMs,
  };
}

function clearConfigCache() {
  configByKeyCache.clear();
  allConfigCache = null;
}

export function __resetConfigCacheForTests() {
  clearConfigCache();
  now = () => Date.now();
}

export function __setConfigCacheClockForTests(clock: () => number) {
  now = clock;
}

export async function getConfig(key: string): Promise<any> {
  const cached = configByKeyCache.get(key);
  if (isValid(cached)) {
    return cached.value;
  }

  const { data, error } = await supabaseAdmin
    .from('system_config')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) {
    throw new AppError(500, '读取配置失败，请稍后重试。', error.message);
  }

  const value = data?.value ?? null;
  configByKeyCache.set(key, setCacheValue(value));
  return value;
}

export async function getAllConfig() {
  if (isValid(allConfigCache)) {
    return allConfigCache.value;
  }

  const { data, error } = await supabaseAdmin
    .from('system_config')
    .select('key, value, updated_at');

  if (error) {
    throw new AppError(500, '读取配置失败，请稍后重试。', error.message);
  }

  const records = data || [];
  allConfigCache = setCacheValue(records);
  for (const record of records) {
    configByKeyCache.set(record.key, setCacheValue(record.value));
  }
  return records;
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

  clearConfigCache();
}
