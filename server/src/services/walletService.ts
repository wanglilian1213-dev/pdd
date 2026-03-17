import { supabaseAdmin } from '../lib/supabase';
import { AppError, InsufficientBalanceError } from '../lib/errors';
import {
  addBalanceAtomic,
  freezeCreditsAtomic,
  refundCreditsAtomic,
  settleCreditsAtomic,
} from './atomicOpsService';

export async function getBalance(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('wallets')
    .select('balance, frozen')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new AppError(404, '钱包不存在，请联系客服。');
  }
  return data;
}

export async function addBalance(userId: string, amount: number, type: 'recharge' | 'refund', refType: string, refId: string, note: string) {
  const result = await addBalanceAtomic(userId, amount, type, refType, refId, note);
  return { balance: result.balance };
}

export async function freezeCredits(userId: string, amount: number, refType: string, refId: string, note: string) {
  try {
    return await freezeCreditsAtomic(userId, amount, refType, refId, note);
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      throw error;
    }
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, '积分冻结失败。');
  }
}

export async function settleCredits(userId: string, amount: number) {
  await settleCreditsAtomic(userId, amount);
}

export async function refundCredits(userId: string, amount: number, refType: string, refId: string, note: string) {
  return refundCreditsAtomic(userId, amount, refType, refId, note);
}

export async function getLedger(userId: string, limit = 20, offset = 0) {
  const { data, error, count } = await supabaseAdmin
    .from('credit_ledger')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new AppError(500, '获取记录失败。');
  }

  return { records: data || [], total: count || 0 };
}
