import { supabaseAdmin } from '../lib/supabase';
import { AppError, InsufficientBalanceError } from '../lib/errors';

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
  const { data: wallet, error: walletError } = await supabaseAdmin
    .from('wallets')
    .select('balance')
    .eq('user_id', userId)
    .single();

  if (walletError || !wallet) {
    throw new AppError(500, '钱包操作失败，请稍后重试。');
  }

  const newBalance = wallet.balance + amount;

  const { error: updateError } = await supabaseAdmin
    .from('wallets')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (updateError) {
    throw new AppError(500, '余额更新失败，请稍后重试。');
  }

  const { error: ledgerError } = await supabaseAdmin
    .from('credit_ledger')
    .insert({
      user_id: userId,
      type,
      amount,
      balance_after: newBalance,
      ref_type: refType,
      ref_id: refId,
      note,
    });

  if (ledgerError) {
    await supabaseAdmin
      .from('wallets')
      .update({ balance: wallet.balance })
      .eq('user_id', userId);
    throw new AppError(500, '流水记录失败，请稍后重试。');
  }

  return { balance: newBalance };
}

export async function freezeCredits(userId: string, amount: number, refType: string, refId: string, note: string) {
  const { data: wallet, error } = await supabaseAdmin
    .from('wallets')
    .select('balance, frozen')
    .eq('user_id', userId)
    .single();

  if (error || !wallet) {
    throw new AppError(500, '钱包操作失败。');
  }

  if (wallet.balance < amount) {
    throw new InsufficientBalanceError();
  }

  const newBalance = wallet.balance - amount;
  const newFrozen = wallet.frozen + amount;

  const { error: updateError } = await supabaseAdmin
    .from('wallets')
    .update({ balance: newBalance, frozen: newFrozen, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (updateError) {
    throw new AppError(500, '积分冻结失败。');
  }

  const { error: ledgerError } = await supabaseAdmin
    .from('credit_ledger')
    .insert({
      user_id: userId,
      type: 'consume',
      amount: -amount,
      balance_after: newBalance,
      ref_type: refType,
      ref_id: refId,
      note,
    });

  if (ledgerError) {
    await supabaseAdmin
      .from('wallets')
      .update({ balance: wallet.balance, frozen: wallet.frozen })
      .eq('user_id', userId);
    throw new AppError(500, '流水记录失败。');
  }

  return { balance: newBalance, frozen: newFrozen };
}

export async function settleCredits(userId: string, amount: number) {
  const { data: wallet, error } = await supabaseAdmin
    .from('wallets')
    .select('frozen')
    .eq('user_id', userId)
    .single();

  if (error || !wallet) {
    throw new AppError(500, '结算失败。');
  }

  const { error: updateError } = await supabaseAdmin
    .from('wallets')
    .update({ frozen: wallet.frozen - amount, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (updateError) {
    throw new AppError(500, '结算失败。');
  }
}

export async function refundCredits(userId: string, amount: number, refType: string, refId: string, note: string) {
  const { data: wallet, error } = await supabaseAdmin
    .from('wallets')
    .select('balance, frozen')
    .eq('user_id', userId)
    .single();

  if (error || !wallet) {
    throw new AppError(500, '退款失败。');
  }

  const newBalance = wallet.balance + amount;
  const newFrozen = wallet.frozen - amount;

  const { error: updateError } = await supabaseAdmin
    .from('wallets')
    .update({ balance: newBalance, frozen: newFrozen, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (updateError) {
    throw new AppError(500, '退款失败。');
  }

  const { error: ledgerError } = await supabaseAdmin
    .from('credit_ledger')
    .insert({
      user_id: userId,
      type: 'refund',
      amount,
      balance_after: newBalance,
      ref_type: refType,
      ref_id: refId,
      note,
    });

  if (ledgerError) {
    await supabaseAdmin
      .from('wallets')
      .update({ balance: wallet.balance, frozen: wallet.frozen })
      .eq('user_id', userId);
    throw new AppError(500, '退款流水记录失败。');
  }

  return { balance: newBalance, frozen: newFrozen };
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
