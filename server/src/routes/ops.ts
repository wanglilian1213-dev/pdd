import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { getAllConfig, getConfig, setConfig } from '../services/configService';
import {
  DEFAULT_ACTIVATION_DENOMINATIONS,
  validateGenerateCodeInput,
  validateUuidOrThrow,
  validateVoidCodeIds,
} from '../services/opsService';
import { voidRechargeCodesAtomic } from '../services/atomicOpsService';

const router = Router();

// GET /api/ops/users
router.get('/users', async (_req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('id, email, nickname, status, created_at, wallets(balance, frozen)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const users = await Promise.all((data || []).map(async (user: any) => {
      const { data: activeTask } = await supabaseAdmin
        .from('tasks')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'processing')
        .single();

      return {
        ...user,
        balance: Array.isArray(user.wallets) ? user.wallets[0]?.balance ?? 0 : user.wallets?.balance ?? 0,
        frozen: Array.isArray(user.wallets) ? user.wallets[0]?.frozen ?? 0 : user.wallets?.frozen ?? 0,
        hasActiveTask: !!activeTask,
      };
    }));

    res.json({ success: true, data: users });
  } catch {
    res.status(500).json({ success: false, error: '获取用户列表失败。' });
  }
});

// POST /api/ops/users/:id/disable
router.post('/users/:id/disable', async (req: AuthRequest, res: Response) => {
  try {
    const userId = validateUuidOrThrow(req.params.id, '账号');
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .update({ status: 'disabled', updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError(404, '账号不存在。');
    res.json({ success: true });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, error: err.userMessage || '操作失败。' });
  }
});

// POST /api/ops/users/:id/enable
router.post('/users/:id/enable', async (req: AuthRequest, res: Response) => {
  try {
    const userId = validateUuidOrThrow(req.params.id, '账号');
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError(404, '账号不存在。');
    res.json({ success: true });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, error: err.userMessage || '操作失败。' });
  }
});

// POST /api/ops/codes/generate
router.post('/codes/generate', async (req: AuthRequest, res: Response) => {
  try {
    const activationDenominations = (await getConfig('activation_denominations')) || DEFAULT_ACTIVATION_DENOMINATIONS;
    const { denomination, count } = validateGenerateCodeInput(
      req.body?.denomination,
      req.body?.count,
      Array.isArray(activationDenominations) ? activationDenominations : DEFAULT_ACTIVATION_DENOMINATIONS,
    );

    const batchId = `BATCH-${Date.now()}`;
    const codes = [];

    for (let i = 0; i < count; i++) {
      codes.push({
        code: generateCodeString(),
        denomination,
        status: 'unused',
        created_by: req.userEmail!,
        batch_id: batchId,
      });
    }

    const { error } = await supabaseAdmin.from('recharge_codes').insert(codes);
    if (error) throw error;

    res.json({ success: true, data: { batchId, count, denomination, codes: codes.map(c => c.code) } });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, error: err.userMessage || '生成激活码失败。' });
  }
});

// POST /api/ops/codes/void
router.post('/codes/void', async (req: AuthRequest, res: Response) => {
  try {
    const codeIds = validateVoidCodeIds(req.body?.codeIds);
    await voidRechargeCodesAtomic(codeIds);
    res.json({ success: true });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, error: err.userMessage || '操作失败。' });
  }
});

// GET /api/ops/codes
router.get('/codes', async (req: AuthRequest, res: Response) => {
  try {
    const { status, batch_id, limit, offset } = req.query;
    let query = supabaseAdmin
      .from('recharge_codes')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(
        parseInt(offset as string) || 0,
        (parseInt(offset as string) || 0) + (parseInt(limit as string) || 50) - 1,
      );

    if (status) query = query.eq('status', status as string);
    if (batch_id) query = query.eq('batch_id', batch_id as string);

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, data: { codes: data, total: count } });
  } catch {
    res.status(500).json({ success: false, error: '获取激活码列表失败。' });
  }
});

// GET /api/ops/tasks
router.get('/tasks', async (_req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select('id, user_id, title, stage, status, target_words, failure_stage, failure_reason, refunded, frozen_credits, created_at, updated_at, completed_at, user_profiles(email)')
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const tasks = await Promise.all((data || []).map(async (task: any) => {
      const { data: lastFailedHumanize } = await supabaseAdmin
        .from('humanize_jobs')
        .select('id, failure_reason, refunded, created_at')
        .eq('task_id', task.id)
        .eq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      return {
        ...task,
        userEmail: task.user_profiles?.email,
        lastFailedHumanize: lastFailedHumanize || null,
      };
    }));

    res.json({ success: true, data: tasks });
  } catch {
    res.status(500).json({ success: false, error: '获取任务列表失败。' });
  }
});

// GET /api/ops/config
router.get('/config', async (_req: AuthRequest, res: Response) => {
  try {
    const config = await getAllConfig();
    res.json({ success: true, data: config });
  } catch {
    res.status(500).json({ success: false, error: '获取配置失败。' });
  }
});

// PUT /api/ops/config/:key
router.put('/config/:key', async (req: AuthRequest, res: Response) => {
  try {
    const { value } = req.body;
    await setConfig(req.params.key as string, value, req.userEmail!);
    res.json({ success: true });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, error: err.userMessage || '更新配置失败。' });
  }
});

function generateCodeString(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 16; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
    if (i === 3 || i === 7 || i === 11) code += '-';
  }
  return code;
}

export default router;
