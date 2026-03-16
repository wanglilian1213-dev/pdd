import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';

export async function initUser(userId: string, email: string) {
  const { data: existing } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('id', userId)
    .single();

  if (existing) {
    return { alreadyExists: true };
  }

  const { error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .insert({ id: userId, email });

  if (profileError) {
    throw new AppError(500, '账号初始化失败，请稍后重试。', profileError.message);
  }

  const { error: walletError } = await supabaseAdmin
    .from('wallets')
    .insert({ user_id: userId, balance: 0, frozen: 0 });

  if (walletError) {
    await supabaseAdmin.from('user_profiles').delete().eq('id', userId);
    throw new AppError(500, '账号初始化失败，请稍后重试。', walletError.message);
  }

  return { alreadyExists: false };
}

export async function getProfile(userId: string) {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email, nickname, status, created_at')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    throw new AppError(404, '用户信息不存在，请联系客服。');
  }

  const { data: wallet } = await supabaseAdmin
    .from('wallets')
    .select('balance, frozen')
    .eq('user_id', userId)
    .single();

  const { data: activeTask } = await supabaseAdmin
    .from('tasks')
    .select('id, stage, title')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .single();

  return {
    ...profile,
    balance: wallet?.balance ?? 0,
    frozen: wallet?.frozen ?? 0,
    activeTask: activeTask || null,
  };
}
