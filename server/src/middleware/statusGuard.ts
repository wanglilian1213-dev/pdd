import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { supabaseAdmin } from '../lib/supabase';

export async function statusGuard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('status')
      .eq('id', req.userId!)
      .single();

    if (!profile) {
      res.status(403).json({ success: false, error: '账号未初始化，请重新注册或联系客服。' });
      return;
    }
    if (profile.status === 'disabled') {
      res.status(403).json({ success: false, error: '您的账号已被禁用，如有疑问请联系客服。' });
      return;
    }
    next();
  } catch {
    res.status(500).json({ success: false, error: '服务异常，请稍后重试。' });
  }
}
