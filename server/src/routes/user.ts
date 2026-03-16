import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { initUser, getProfile } from '../services/userService';
import { statusGuard } from '../middleware/statusGuard';
import { registerLimiter } from '../middleware/rateLimiter';

const router = Router();

// POST /api/user/init — 注册后初始化（不需要 statusGuard，因为还没初始化）
router.post('/init', registerLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const result = await initUser(req.userId!, req.userEmail!);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '服务异常，请稍后重试。' });
  }
});

// GET /api/user/profile — 获取用户信息+余额+当前任务
router.get('/profile', statusGuard, async (req: AuthRequest, res: Response) => {
  try {
    const profile = await getProfile(req.userId!);
    res.json({ success: true, data: profile });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '服务异常，请稍后重试。' });
  }
});

export default router;
