import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { statusGuard } from '../middleware/statusGuard';
import { redeemLimiter } from '../middleware/rateLimiter';
import { redeemCode } from '../services/rechargeService';
import { getLedger } from '../services/walletService';

const router = Router();

// POST /api/recharge/redeem
router.post('/redeem', statusGuard, redeemLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      res.status(400).json({ success: false, error: '请输入激活码。' });
      return;
    }
    const result = await redeemCode(req.userId!, code);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '兑换失败，请稍后重试。' });
  }
});

// GET /api/recharge/history
router.get('/history', statusGuard, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await getLedger(req.userId!, limit, offset);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '获取记录失败。' });
  }
});

export default router;
