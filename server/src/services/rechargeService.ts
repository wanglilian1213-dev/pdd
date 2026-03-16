import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { addBalance } from './walletService';

export async function redeemCode(userId: string, code: string) {
  const { data: codeRecord, error } = await supabaseAdmin
    .from('recharge_codes')
    .select('*')
    .eq('code', code.trim())
    .single();

  if (error || !codeRecord) {
    throw new AppError(400, '激活码不存在，请检查输入是否正确。');
  }

  if (codeRecord.status === 'used') {
    throw new AppError(400, '该激活码已被使用。');
  }

  if (codeRecord.status === 'voided') {
    throw new AppError(400, '该激活码已失效。');
  }

  const { error: updateError } = await supabaseAdmin
    .from('recharge_codes')
    .update({
      status: 'used',
      used_by: userId,
      used_at: new Date().toISOString(),
    })
    .eq('id', codeRecord.id)
    .eq('status', 'unused');

  if (updateError) {
    throw new AppError(500, '兑换失败，请稍后重试。');
  }

  const result = await addBalance(
    userId,
    codeRecord.denomination,
    'recharge',
    'recharge_code',
    codeRecord.id,
    `兑换激活码 ${codeRecord.denomination} 积分`,
  );

  return {
    denomination: codeRecord.denomination,
    balance: result.balance,
  };
}
