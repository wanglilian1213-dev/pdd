import { AppError } from '../lib/errors';
import { validate as isUuid } from 'uuid';

const POSITIVE_INTEGER_CONFIG_KEYS = new Set([
  'writing_price_per_1000',
  'humanize_price_per_1000',
  'result_file_retention_days',
  'material_retention_days',
  'stuck_task_timeout_minutes',
  'max_outline_edits',
  'outline_edit_cost',
  'revision_price_per_1000',
]);

// 正小数（> 0）配置项。评审功能走 0.1 积分/word，是项目里第一个小数配置。
// 以后如果还有类似小数配置（例如某些功能要按秒计费），也加到这里。
const POSITIVE_NUMBER_CONFIG_KEYS = new Set([
  'scoring_price_per_word',
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

  if (POSITIVE_NUMBER_CONFIG_KEYS.has(key)) {
    // 支持 number / 数字字符串（前端 JSON 序列化时可能把 0.1 存成 "0.1"）
    let num: number;
    if (typeof value === 'number') {
      num = value;
    } else if (typeof value === 'string' && value.trim() !== '') {
      num = Number(value);
    } else {
      throw new AppError(400, '配置值格式不对。这里必须填写大于 0 的正数（可带小数）。');
    }
    if (!Number.isFinite(num) || num <= 0) {
      throw new AppError(400, '配置值格式不对。这里必须填写大于 0 的正数（可带小数）。');
    }
    // 统一以字符串保存，避免 JSON 里浮点数精度抖动（与 revision_price_per_1000 的现有风格一致）
    return num.toString();
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
