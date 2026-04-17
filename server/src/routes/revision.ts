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
  estimateRevisionForFile,
  getRevisionPricePerWord,
  validateRevisionFileTypes,
} from '../services/revisionService';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.use(statusGuard);

// POST /api/revision/estimate
//
// 增量预估单文件字数和金额，供前端「选完文件实时显示预估冻结积分」用。
// - 只接受单文件（前端维护 Map<File, words> 累加，删除文件时不发请求）
// - 只做字数解析，不写库不冻结
// - 扫描件 PDF 直接 400 拒绝，前端会把该文件从列表移除
// - 估算超时（30s）/ pdf-parse 抛错 → 也按扫描件 400 拒绝
router.post('/estimate', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: '请上传一个文件。' });
      return;
    }

    validateRevisionFileTypes([file]);
    const result = await estimateRevisionForFile(file);

    if (result.isScannedPdf) {
      res.status(400).json({
        success: false,
        error: `文件 ${file.originalname} 看起来是扫描件 PDF，无法修改文字内容，请改上传 .docx 或文字版 PDF。`,
      });
      return;
    }

    const pricePerWord = await getRevisionPricePerWord();
    res.json({
      success: true,
      data: {
        filename: file.originalname,
        words: result.words,
        pricePerWord,
      },
    });
  } catch (err: unknown) {
    const appErr = err as { statusCode?: number; userMessage?: string };
    const status = appErr.statusCode || 500;
    res.status(status).json({ success: false, error: appErr.userMessage || '预估失败。' });
  }
});

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
