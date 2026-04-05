import { Router, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import { statusGuard } from '../middleware/statusGuard';
import { validateFiles } from '../services/fileService';
import {
  createRevision,
  getRevision,
  getRevisionCurrent,
  getRevisionList,
  getRevisionDownloadUrl,
} from '../services/revisionService';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.use(statusGuard);

// POST /api/revision/create
router.post('/create', upload.array('files', 10), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    const { instructions } = req.body;

    if (!instructions || typeof instructions !== 'string' || instructions.trim().length === 0) {
      res.status(400).json({ success: false, error: '请输入修改要求。' });
      return;
    }

    if (instructions.length > 5000) {
      res.status(400).json({ success: false, error: '修改要求不能超过 5000 字。' });
      return;
    }

    validateFiles(files);

    const revision = await createRevision(req.userId!, instructions.trim(), files);
    res.json({ success: true, data: revision });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '创建修改请求失败。' });
  }
});

// GET /api/revision/current
router.get('/current', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getRevisionCurrent(req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取修改状态失败。' });
  }
});

// GET /api/revision/list
router.get('/list', async (req: AuthRequest, res: Response) => {
  try {
    const { limit, offset } = req.query;
    const result = await getRevisionList(
      req.userId!,
      Math.min(parseInt(limit as string) || 20, 100),
      parseInt(offset as string) || 0,
    );
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取修改记录失败。' });
  }
});

// GET /api/revision/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getRevision(req.params.id as string, req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取修改记录失败。' });
  }
});

// GET /api/revision/:id/file/:fileId/download
router.get('/:id/file/:fileId/download', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getRevisionDownloadUrl(
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
