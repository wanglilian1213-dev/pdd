import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { env } from '../lib/runtimeEnv';
import { isOpsWhitelisted } from '../services/opsService';

export function opsMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!isOpsWhitelisted(req.userEmail, env.opsWhitelistEmails)) {
    res.status(403).json({ success: false, error: '无权限访问运营功能。' });
    return;
  }
  next();
}
