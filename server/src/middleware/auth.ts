import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, '请先登录。');
    }
    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      throw new AppError(401, '登录已过期，请重新登录。');
    }
    req.userId = user.id;
    req.userEmail = user.email;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.userMessage });
    } else {
      res.status(401).json({ success: false, error: '认证失败，请重新登录。' });
    }
  }
}
