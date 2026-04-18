import { Router, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import { statusGuard } from '../middleware/statusGuard';
import {
  acknowledgeStandaloneHumanize,
  createStandaloneHumanize,
  estimateStandaloneHumanizeForFile,
  getStandaloneHumanize,
  getStandaloneHumanizeCurrent,
  getStandaloneHumanizeDownloadUrl,
  getStandaloneHumanizeList,
  validateStandaloneHumanizeFiles,
} from '../services/standaloneHumanizeService';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.use(statusGuard);

// POST /api/standalone-humanize/estimate
router.post('/estimate', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ success: false, error: '请上传文件。' });
    }
    const result = await estimateStandaloneHumanizeForFile(file);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '预估失败。' });
  }
});

// POST /api/standalone-humanize/create
router.post('/create', upload.array('files', 1), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    validateStandaloneHumanizeFiles(files);
    const row = await createStandaloneHumanize(req.userId!, files[0]);
    res.json({ success: true, data: row });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '创建降 AI 请求失败。' });
  }
});

// GET /api/standalone-humanize/current
router.get('/current', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getStandaloneHumanizeCurrent(req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取降 AI 状态失败。' });
  }
});

// GET /api/standalone-humanize/list
router.get('/list', async (req: AuthRequest, res: Response) => {
  try {
    const { limit, offset } = req.query;
    const result = await getStandaloneHumanizeList(
      req.userId!,
      Math.min(parseInt(limit as string) || 20, 100),
      parseInt(offset as string) || 0,
    );
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取降 AI 记录失败。' });
  }
});

// GET /api/standalone-humanize/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getStandaloneHumanize(req.params.id as string, req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取降 AI 记录失败。' });
  }
});

// GET /api/standalone-humanize/:id/file/:fileId/download
router.get('/:id/file/:fileId/download', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getStandaloneHumanizeDownloadUrl(
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

// POST /api/standalone-humanize/:id/acknowledge
router.post('/:id/acknowledge', async (req: AuthRequest, res: Response) => {
  try {
    const result = await acknowledgeStandaloneHumanize(req.params.id as string, req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '确认失败。' });
  }
});

export default router;
