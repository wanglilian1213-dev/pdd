import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { sendChatMessage } from '../services/chatService';
import { captureError } from '../lib/errorMonitor';

const router = Router();

// POST /api/chat/message
router.post('/message', async (req: AuthRequest, res: Response) => {
  try {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ success: false, error: '消息不能为空。' });
      return;
    }

    if (message.length > 500) {
      res.status(400).json({ success: false, error: '消息不能超过 500 字。' });
      return;
    }

    const safeHistory = Array.isArray(history) ? history : [];

    const result = await sendChatMessage(
      req.userId!,
      req.userEmail!,
      message.trim(),
      safeHistory,
    );

    res.json({
      success: true,
      data: { reply: result.reply, remainingToday: result.remaining },
    });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };

    if (appErr.statusCode === 429) {
      res.status(429).json({ success: false, error: appErr.userMessage });
      return;
    }

    captureError(err, 'chat.message');
    res.status(502).json({
      success: false,
      error: 'AI 客服暂时不可用，请稍后再试或联系人工客服微信 PDDService01。',
    });
  }
});

export default router;
