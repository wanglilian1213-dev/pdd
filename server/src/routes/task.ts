import { Router, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import { statusGuard } from '../middleware/statusGuard';
import { createTask, getTask, getCurrentTask, getTaskList, deleteTask, discardPendingTask } from '../services/taskService';
import { validateFiles, uploadFiles, getDownloadUrl } from '../services/fileService';
import { generateOutline, regenerateOutline, confirmOutline } from '../services/outlineService';
import { startHumanize } from '../services/humanizeService';
import { captureError } from '../lib/errorMonitor';
import { deriveTaskTitle } from '../services/paperTitleService';
import {
  validateEditInstruction,
  validateTaskListStatus,
} from '../services/requestValidationService';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.use(statusGuard);

// POST /api/task/create
router.post('/create', upload.array('files', 10), async (req: AuthRequest, res: Response) => {
  let createdTaskId: string | null = null;
  try {
    const files = req.files as Express.Multer.File[];
    const { title, specialRequirements } = req.body;

    validateFiles(files);

    const taskTitle = deriveTaskTitle(title, files[0]?.originalname, '未命名任务');
    const task = await createTask(req.userId!, taskTitle, specialRequirements || '');
    createdTaskId = task.id;

    await uploadFiles(task.id, files);

    // 异步启动大纲生成（不阻塞响应）
    generateOutline(task.id, req.userId!).catch(err => {
      captureError(err, 'task.generate_outline', { taskId: task.id });
    });

    res.json({ success: true, data: task });
  } catch (err: unknown) {
    if (createdTaskId) {
      await deleteTask(createdTaskId).catch((cleanupError) => {
        captureError(cleanupError, 'task.cleanup_half_created', { taskId: createdTaskId });
      });
    }
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
      validateTaskListStatus(taskStatus),
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

// POST /api/task/:id/outline/regenerate
router.post('/:id/outline/regenerate', async (req: AuthRequest, res: Response) => {
  try {
    const editInstruction = validateEditInstruction(req.body?.editInstruction);
    const outline = await regenerateOutline(req.params.id as string, req.userId!, editInstruction);
    res.json({ success: true, data: outline });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '大纲修改失败。' });
  }
});

// POST /api/task/:id/outline/confirm
router.post('/:id/outline/confirm', async (req: AuthRequest, res: Response) => {
  try {
    const result = await confirmOutline(req.params.id as string, req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    if (status >= 500) {
      console.error(`[POST /:id/outline/confirm] taskId=${req.params.id} userId=${req.userId}`, err);
    }
    res.status(status).json({ success: false, error: appErr.userMessage || '确认大纲失败。' });
  }
});

// POST /api/task/:id/humanize
router.post('/:id/humanize', async (req: AuthRequest, res: Response) => {
  try {
    const result = await startHumanize(req.params.id as string, req.userId!);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '降 AI 启动失败。' });
  }
});

// POST /api/task/:id/discard
router.post('/:id/discard', async (req: AuthRequest, res: Response) => {
  try {
    await discardPendingTask(req.params.id as string, req.userId!);
    res.json({ success: true, data: { discarded: true } });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '放弃任务失败。' });
  }
});

export default router;
