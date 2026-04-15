import { Router, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import { statusGuard } from '../middleware/statusGuard';
import { validateFiles } from '../services/fileService';
import {
  createScoring,
  getScoring,
  getScoringCurrent,
  getScoringList,
  getScoringDownloadUrl,
} from '../services/scoringService';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.use(statusGuard);

// POST /api/scoring/create
// 注意：评审没有 instructions 文本框。GPT 完全基于上传的文件自己判哪份是 article / rubric / brief。
router.post('/create', upload.array('files', 10), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];

    validateFiles(files);

    const scoring = await createScoring(req.userId!, files);
    res.json({ success: true, data: scoring });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res
      .status(status)
      .json({ success: false, error: appErr.userMessage || '创建评审请求失败。' });
  }
});

// GET /api/scoring/current
router.get('/current', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getScoringCurrent(req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res
      .status(status)
      .json({ success: false, error: appErr.userMessage || '获取评审状态失败。' });
  }
});

// GET /api/scoring/list
router.get('/list', async (req: AuthRequest, res: Response) => {
  try {
    const { limit, offset } = req.query;
    const result = await getScoringList(
      req.userId!,
      Math.min(parseInt(limit as string) || 20, 100),
      parseInt(offset as string) || 0,
    );
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res
      .status(status)
      .json({ success: false, error: appErr.userMessage || '获取评审记录失败。' });
  }
});

// GET /api/scoring/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getScoring(req.params.id as string, req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res
      .status(status)
      .json({ success: false, error: appErr.userMessage || '获取评审记录失败。' });
  }
});

// GET /api/scoring/:id/file/:fileId/download
router.get('/:id/file/:fileId/download', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getScoringDownloadUrl(
      req.params.id as string,
      req.params.fileId as string,
      req.userId!,
    );
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '下载失败。' });
  }
});

export default router;
