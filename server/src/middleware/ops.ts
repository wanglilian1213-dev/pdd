import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { env } from '../config/env';

export function opsMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userEmail || !env.opsWhitelistEmails.includes(req.userEmail)) {
    res.status(403).json({ success: false, error: '无权限访问运营功能。' });
    return;
  }
  next();
}
