import { AppError, InsufficientBalanceError } from '../lib/errors';
import { supabaseAdmin } from '../lib/supabase';

export interface WalletMutationResult {
  balance: number;
  frozen: number;
}

export interface RedeemCodeResult {
  denomination: number;
  balance: number;
}

export interface ConfirmOutlineResult {
  taskId: string;
  stage: 'writing';
  frozenCredits: number;
}

export interface StartHumanizeResult {
  jobId: string;
  stage: 'humanizing';
  frozenCredits: number;
}

export interface VoidRechargeCodesResult {
  voidedCount: number;
}

function getRpcErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  const maybeMessage = 'message' in error ? error.message : '';
  return typeof maybeMessage === 'string' ? maybeMessage : '';
}

function mapWalletRpcError(error: unknown, fallbackMessage: string) {
  const message = getRpcErrorMessage(error);

  if (message.includes('INSUFFICIENT_BALANCE')) {
    return new InsufficientBalanceError();
  }

  if (message.includes('WALLET_NOT_FOUND')) {
    return new AppError(500, '钱包不存在，请联系客服。', message);
  }

  if (message.includes('INSUFFICIENT_FROZEN_BALANCE')) {
    return new AppError(500, '冻结积分异常，请联系客服处理。', message);
  }

  return new AppError(500, fallbackMessage, message);
}

async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  mapError: (error: unknown) => AppError,
): Promise<T> {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) {
    throw mapError(error);
  }
  if (!data) {
    throw new AppError(500, '数据库返回为空，请稍后重试。');
  }
  return data as T;
}

export async function addBalanceAtomic(
  userId: string,
  amount: number,
  type: 'recharge' | 'refund',
  refType: string,
  refId: string,
  note: string,
): Promise<WalletMutationResult> {
  return callRpc<WalletMutationResult>(
    'wallet_credit_balance',
    {
      p_user_id: userId,
      p_amount: amount,
      p_type: type,
      p_ref_type: refType,
      p_ref_id: refId,
      p_note: note,
    },
    (error) => mapWalletRpcError(error, '余额更新失败，请稍后重试。'),
  );
}

export async function freezeCreditsAtomic(
  userId: string,
  amount: number,
  refType: string,
  refId: string,
  note: string,
): Promise<WalletMutationResult> {
  return callRpc<WalletMutationResult>(
    'wallet_freeze_credits',
    {
      p_user_id: userId,
      p_amount: amount,
      p_ref_type: refType,
      p_ref_id: refId,
      p_note: note,
    },
    (error) => mapWalletRpcError(error, '积分冻结失败，请稍后重试。'),
  );
}

export async function settleCreditsAtomic(userId: string, amount: number): Promise<WalletMutationResult> {
  return callRpc<WalletMutationResult>(
    'wallet_settle_credits',
    {
      p_user_id: userId,
      p_amount: amount,
    },
    (error) => mapWalletRpcError(error, '积分结算失败，请稍后重试。'),
  );
}

export async function refundCreditsAtomic(
  userId: string,
  amount: number,
  refType: string,
  refId: string,
  note: string,
): Promise<WalletMutationResult> {
  return callRpc<WalletMutationResult>(
    'wallet_refund_credits',
    {
      p_user_id: userId,
      p_amount: amount,
      p_ref_type: refType,
      p_ref_id: refId,
      p_note: note,
    },
    (error) => mapWalletRpcError(error, '积分退款失败，请稍后重试。'),
  );
}

export async function redeemRechargeCodeAtomic(userId: string, code: string): Promise<RedeemCodeResult> {
  return callRpc<RedeemCodeResult>(
    'redeem_recharge_code',
    {
      p_user_id: userId,
      p_code: code.trim(),
    },
    (error) => {
      const message = getRpcErrorMessage(error);
      if (message.includes('INVALID_RECHARGE_CODE')) {
        return new AppError(400, '激活码不存在，请检查输入是否正确。', message);
      }
      if (message.includes('RECHARGE_CODE_ALREADY_USED')) {
        return new AppError(400, '该激活码已被使用。', message);
      }
      if (message.includes('RECHARGE_CODE_VOIDED')) {
        return new AppError(400, '该激活码已失效。', message);
      }
      return mapWalletRpcError(error, '兑换失败，请稍后重试。');
    },
  );
}

export async function confirmOutlineTaskAtomic(
  taskId: string,
  userId: string,
  targetWords: number,
  citationStyle: string,
  cost: number,
): Promise<ConfirmOutlineResult> {
  return callRpc<ConfirmOutlineResult>(
    'confirm_outline_task',
    {
      p_task_id: taskId,
      p_user_id: userId,
      p_target_words: targetWords,
      p_citation_style: citationStyle,
      p_cost: cost,
    },
    (error) => {
      const message = getRpcErrorMessage(error);
      if (message.includes('TASK_NOT_FOUND_OR_FORBIDDEN')) {
        return new AppError(404, '任务不存在。', message);
      }
      if (message.includes('TASK_NOT_READY')) {
        return new AppError(400, '当前阶段无法确认大纲，请刷新页面后重试。', message);
      }
      return mapWalletRpcError(error, '确认大纲失败，请稍后重试。');
    },
  );
}

export async function startHumanizeJobAtomic(
  taskId: string,
  userId: string,
  inputVersionId: string,
  inputWordCount: number,
  cost: number,
): Promise<StartHumanizeResult> {
  return callRpc<StartHumanizeResult>(
    'start_humanize_job',
    {
      p_task_id: taskId,
      p_user_id: userId,
      p_input_version_id: inputVersionId,
      p_input_word_count: inputWordCount,
      p_cost: cost,
    },
    (error) => {
      const message = getRpcErrorMessage(error);
      if (message.includes('TASK_NOT_FOUND_OR_FORBIDDEN')) {
        return new AppError(404, '任务不存在。', message);
      }
      if (message.includes('HUMANIZE_TASK_NOT_COMPLETED')) {
        return new AppError(400, '只有已完成的任务才能发起降 AI。', message);
      }
      if (message.includes('HUMANIZE_ALREADY_PROCESSING')) {
        return new AppError(400, '当前已有降 AI 任务在处理中，请等待完成。', message);
      }
      if (message.includes('INPUT_VERSION_NOT_FOUND')) {
        return new AppError(500, '找不到可用的正文版本。', message);
      }
      return mapWalletRpcError(error, '降 AI 启动失败，请稍后重试。');
    },
  );
}

export async function voidRechargeCodesAtomic(codeIds: string[]): Promise<VoidRechargeCodesResult> {
  return callRpc<VoidRechargeCodesResult>(
    'void_recharge_codes',
    {
      p_code_ids: codeIds,
    },
    (error) => {
      const message = getRpcErrorMessage(error);
      if (message.includes('RECHARGE_CODE_NONE_VOIDABLE')) {
        return new AppError(400, '没有找到可作废的未使用激活码。', message);
      }
      if (message.includes('RECHARGE_CODE_PARTIAL_VOID')) {
        return new AppError(400, '这批激活码里只有一部分能作废。请刷新列表后重新选择。', message);
      }
      return new AppError(500, '作废激活码失败，请稍后重试。', message);
    },
  );
}
