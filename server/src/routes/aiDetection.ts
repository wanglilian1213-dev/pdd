import { NextFunction, Router, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import { statusGuard } from '../middleware/statusGuard';
import {
  createAiDetection,
  estimateAiDetectionForFile,
  getAiDetection,
  getAiDetectionCurrent,
  getAiDetectionList,
  validateAiDetectionFiles,
} from '../services/aiDetectionService';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();
const SINGLE_FILE_ERROR = 'AI 检测一次只能处理一个文件，请分批提交。';

export function parseAiDetectionFiles(req: AuthRequest, res: Response, next: NextFunction) {
  upload.array('files', 1)(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ success: false, error: SINGLE_FILE_ERROR });
      return;
    }
    if (err) {
      res.status(400).json({ success: false, error: '文件上传失败，请重新选择文件。' });
      return;
    }
    next();
  });
}

router.use(statusGuard);

// POST /api/ai-detection/estimate
// 前端选文件后显示"预估 N 积分"；不扣积分，不入库。
router.post('/estimate', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ success: false, error: '请上传文件。' });
    }
    const result = await estimateAiDetectionForFile(file);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '预估失败。' });
  }
});

// POST /api/ai-detection/create
router.post('/create', parseAiDetectionFiles, async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    validateAiDetectionFiles(files);
    const detection = await createAiDetection(req.userId!, files[0]);
    res.json({ success: true, data: detection });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '创建检测请求失败。' });
  }
});

// GET /api/ai-detection/current
router.get('/current', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getAiDetectionCurrent(req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取检测状态失败。' });
  }
});

// GET /api/ai-detection/list
router.get('/list', async (req: AuthRequest, res: Response) => {
  try {
    const { limit, offset } = req.query;
    const result = await getAiDetectionList(
      req.userId!,
      Math.min(parseInt(limit as string) || 20, 100),
      parseInt(offset as string) || 0,
    );
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取检测记录失败。' });
  }
});

// GET /api/ai-detection/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getAiDetection(req.params.id as string, req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取检测记录失败。' });
  }
});

export default router;
