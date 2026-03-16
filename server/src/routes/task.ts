import { Router, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import { statusGuard } from '../middleware/statusGuard';
import { createTask, getTask, getCurrentTask, getTaskList } from '../services/taskService';
import { validateFiles, uploadFiles, getDownloadUrl } from '../services/fileService';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.use(statusGuard);

// POST /api/task/create
router.post('/create', upload.array('files', 10), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    const { title, specialRequirements } = req.body;

    validateFiles(files);

    const task = await createTask(req.userId!, title || files[0]?.originalname || '未命名任务', specialRequirements || '');

    await uploadFiles(task.id, files);

    res.json({ success: true, data: task });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '创建任务失败。' });
  }
});

// GET /api/task/current
router.get('/current', async (req: AuthRequest, res: Response) => {
  try {
    const task = await getCurrentTask(req.userId!);
    res.json({ success: true, data: task });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取任务失败。' });
  }
});

// GET /api/task/list
router.get('/list', async (req: AuthRequest, res: Response) => {
  try {
    const { status: taskStatus, limit, offset } = req.query;
    const result = await getTaskList(
      req.userId!,
      taskStatus as string | undefined,
      Math.min(parseInt(limit as string) || 20, 100),
      parseInt(offset as string) || 0,
    );
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取任务列表失败。' });
  }
});

// GET /api/task/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const task = await getTask(req.params.id as string, req.userId!);
    res.json({ success: true, data: task });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '获取任务失败。' });
  }
});

// GET /api/task/:id/file/:fileId/download
router.get('/:id/file/:fileId/download', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getDownloadUrl(req.params.id as string, req.params.fileId as string, req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '下载失败。' });
  }
});

export default router;
