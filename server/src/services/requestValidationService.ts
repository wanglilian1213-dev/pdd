import { AppError } from '../lib/errors';

const MIN_TARGET_WORDS = 500;
const MAX_TARGET_WORDS = 20_000;
const MAX_EDIT_INSTRUCTION_LENGTH = 2_000;
const ALLOWED_TASK_STATUSES = new Set(['processing', 'completed', 'failed']);

export function validateTargetWords(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    throw new AppError(400, '请提供目标字数。');
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed)) {
    throw new AppError(400, '目标字数必须是正整数。');
  }

  if (parsed < MIN_TARGET_WORDS || parsed > MAX_TARGET_WORDS) {
    throw new AppError(400, `目标字数需在 ${MIN_TARGET_WORDS} 到 ${MAX_TARGET_WORDS} 之间。`);
  }

  return parsed;
}

export function validateOptionalTargetWords(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return validateTargetWords(value);
}

export function validateEditInstruction(value: unknown): string {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    throw new AppError(400, '请输入修改意见。');
  }

  if (trimmed.length > MAX_EDIT_INSTRUCTION_LENGTH) {
    throw new AppError(400, `修改意见最多 ${MAX_EDIT_INSTRUCTION_LENGTH} 个字，请删减后重试。`);
  }

  return trimmed;
}

export function validateTaskListStatus(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalized = String(value).trim();
  if (!ALLOWED_TASK_STATUSES.has(normalized)) {
    throw new AppError(400, '任务状态参数不正确。');
  }

  return normalized;
}
