import { AppError } from '../lib/errors';
import { validate as isUuid } from 'uuid';

const POSITIVE_INTEGER_CONFIG_KEYS = new Set([
  'writing_price_per_1000',
  'humanize_price_per_1000',
  'result_file_retention_days',
  'material_retention_days',
  'stuck_task_timeout_minutes',
  'max_outline_edits',
]);

export const DEFAULT_ACTIVATION_DENOMINATIONS = [1000, 3000, 10000, 20000];

export function normalizeOpsEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isOpsWhitelisted(userEmail: string | undefined, whitelistEmails: string[]) {
  if (!userEmail) return false;
  const normalizedUserEmail = normalizeOpsEmail(userEmail);
  return whitelistEmails.some((email) => normalizeOpsEmail(email) === normalizedUserEmail);
}

export function validateGenerateCodeInput(denomination: unknown, count: unknown, allowedDenominations: number[]) {
  if (!Number.isInteger(denomination) || !allowedDenominations.includes(denomination as number)) {
    throw new AppError(400, `面值不合法。当前只允许：${allowedDenominations.join(' / ')} 积分。`);
  }

  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 100) {
    throw new AppError(400, '数量不合法。一次只能生成 1 到 100 个激活码。');
  }

  return {
    denomination: denomination as number,
    count: count as number,
  };
}

export function validateVoidCodeIds(codeIds: unknown) {
  if (!Array.isArray(codeIds) || codeIds.length === 0) {
    throw new AppError(400, '请至少选择一个要作废的激活码。');
  }

  const normalized = codeIds
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new AppError(400, '请至少选择一个要作废的激活码。');
  }

  for (const codeId of normalized) {
    if (!isUuid(codeId)) {
      throw new AppError(400, '激活码 ID 格式不对，请刷新页面后重试。');
    }
  }

  return [...new Set(normalized)];
}

export function validateUuidOrThrow(value: unknown, label: string) {
  if (typeof value !== 'string' || !isUuid(value.trim())) {
    throw new AppError(400, `${label} ID 格式不对，请刷新页面后重试。`);
  }

  return value.trim();
}

export function validateConfigValue(key: string, value: unknown) {
  if (POSITIVE_INTEGER_CONFIG_KEYS.has(key)) {
    if (!Number.isInteger(value) || (value as number) <= 0) {
      throw new AppError(400, '配置值格式不对。这里必须填写大于 0 的整数。');
    }
    return value as number;
  }

  if (key === 'activation_denominations') {
    if (!Array.isArray(value) || value.length === 0) {
      throw new AppError(400, '配置值格式不对。激活码面值必须是至少一个正整数。');
    }

    const normalized = value.map((item) => {
      if (!Number.isInteger(item) || item <= 0) {
        throw new AppError(400, '配置值格式不对。激活码面值必须全部是正整数。');
      }
      return item;
    });

    return [...new Set(normalized)].sort((a, b) => a - b);
  }

  throw new AppError(400, '配置项不存在，不能更新。');
}
