# 拼代代后端实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 搭建拼代代后端服务（Express + TypeScript），接通 Supabase 数据库和 Auth，实现完整业务闭环。

**Architecture:** Monorepo 单仓库，后端在 `server/` 目录。Railway 部署两个 Service：app（业务主服务）和 cleanup（每日清理）。所有业务逻辑在 app 内完成，数据存 Supabase，AI 调用 OpenAI Responses API。

**Tech Stack:** Express, TypeScript, @supabase/supabase-js, openai, multer, docx, express-rate-limit, node-cron

**参考文档：**
- 设计文档：`docs/plans/2026-03-16-backend-design.md`
- PRD：`拼代代PRD.md`
- 架构：`DESIGN.md`
- 开发规矩：`agent.md`

---

## 阶段 0：项目脚手架

### Task 1: 初始化后端项目

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/.env.example`
- Create: `server/.gitignore`

**Step 1: 创建 server 目录和 package.json**

```json
{
  "name": "pindaidai-server",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "start:cleanup": "node dist/cleanup.js",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.49.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.0",
    "express-rate-limit": "^7.5.0",
    "multer": "^1.4.5-lts.1",
    "node-cron": "^3.0.3",
    "openai": "^4.80.0",
    "docx": "^9.2.0",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/multer": "^1.4.12",
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.11",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0"
  }
}
```

**Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: 创建 .env.example**

```env
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# OpenAI
OPENAI_API_KEY=

# 运营白名单（逗号分隔）
OPS_WHITELIST_EMAILS=admin@example.com

# 服务配置
PORT=3001
NODE_ENV=development
```

**Step 4: 创建 .gitignore**

```
node_modules/
dist/
.env
```

**Step 5: 安装依赖**

Run: `cd server && npm install`

**Step 6: 创建 .env 填入真实值**

从用户提供的密钥创建 `server/.env`（不提交到 git）。

**Step 7: Commit**

```bash
git add server/package.json server/tsconfig.json server/.env.example server/.gitignore
git commit -m "chore: init server project scaffold"
```

---

### Task 2: 创建基础代码结构

**Files:**
- Create: `server/src/config/env.ts`
- Create: `server/src/lib/supabase.ts`
- Create: `server/src/lib/openai.ts`
- Create: `server/src/lib/errors.ts`
- Create: `server/src/types/index.ts`
- Create: `server/src/index.ts`

**Step 1: 创建 config/env.ts — 环境变量统一读取**

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const env = {
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  openaiApiKey: process.env.OPENAI_API_KEY!,
  opsWhitelistEmails: (process.env.OPS_WHITELIST_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean),
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
};

// 启动时校验必填变量
const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'] as const;
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}
```

**Step 2: 创建 lib/supabase.ts — Supabase 客户端**

```typescript
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

// 管理员客户端（后端用，绕过 RLS）
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

// 创建用户级客户端（用于验证 JWT）
export function createUserClient(token: string) {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
```

**Step 3: 创建 lib/openai.ts — OpenAI 客户端**

```typescript
import OpenAI from 'openai';
import { env } from '../config/env';

export const openai = new OpenAI({
  apiKey: env.openaiApiKey,
});
```

**Step 4: 创建 lib/errors.ts — 统一错误处理**

```typescript
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public userMessage: string,
    public detail?: string,
  ) {
    super(userMessage);
    this.name = 'AppError';
  }
}

export class InsufficientBalanceError extends AppError {
  constructor() {
    super(400, '余额不足，请先充值后再操作。');
  }
}

export class ActiveTaskExistsError extends AppError {
  constructor() {
    super(400, '您当前有一个进行中的任务，请等待完成后再创建新任务。');
  }
}

export class AccountDisabledError extends AppError {
  constructor() {
    super(403, '您的账号已被禁用，如有疑问请联系客服。');
  }
}
```

**Step 5: 创建 types/index.ts — 共享类型定义**

```typescript
// 用户状态
export type UserStatus = 'active' | 'disabled';

// 任务阶段
export type TaskStage =
  | 'uploading'
  | 'outline_generating'
  | 'outline_ready'
  | 'writing'
  | 'word_calibrating'
  | 'citation_checking'
  | 'delivering'
  | 'completed'
  | 'humanizing';

// 任务状态
export type TaskStatus = 'processing' | 'completed' | 'failed';

// 流水类型
export type LedgerType = 'recharge' | 'consume' | 'refund';

// 激活码状态
export type CodeStatus = 'unused' | 'used' | 'voided';

// 文件类别
export type FileCategory = 'material' | 'final_doc' | 'citation_report' | 'humanized_doc';

// 正文版本阶段
export type DocVersionStage = 'draft' | 'calibrated' | 'verified' | 'final';

// humanize 状态
export type HumanizeStatus = 'processing' | 'completed' | 'failed';

// API 统一响应
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// 允许上传的文件格式
export const ALLOWED_FILE_TYPES = [
  'txt', 'md', 'docx', 'pdf', 'ppt', 'pptx',
  'jpg', 'jpeg', 'png', 'webp', 'gif',
  'heic', 'heif', 'bmp', 'tiff', 'tif',
];

export const MAX_FILES_PER_TASK = 10;
export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
export const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB
```

**Step 6: 创建 index.ts — Express 主入口（最小可运行版本）**

```typescript
import express from 'express';
import cors from 'cors';
import { env } from './config/env';

const app = express();

app.use(cors());
app.use(express.json());

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(env.port, () => {
  console.log(`Server running on port ${env.port}`);
});

export default app;
```

**Step 7: 验证项目能启动**

Run: `cd server && npm run dev`
Expected: 控制台输出 `Server running on port 3001`

Run: `curl http://localhost:3001/health`
Expected: `{"status":"ok","timestamp":"..."}`

**Step 8: 验证类型检查通过**

Run: `cd server && npm run lint`
Expected: 无错误

**Step 9: Commit**

```bash
git add server/src/
git commit -m "feat: add server base structure with supabase, openai clients and types"
```

---

### Task 3: 创建数据库 migration SQL

**Files:**
- Create: `server/supabase/migrations/20260316000000_init.sql`

**Step 1: 编写完整建表 SQL**

```sql
-- 001_init.sql
-- 拼代代数据库初始化
-- 在 Supabase SQL Editor 中执行

-- 1. user_profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  nickname TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. wallets
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  frozen INTEGER NOT NULL DEFAULT 0 CHECK (frozen >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. credit_ledger
CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  type TEXT NOT NULL CHECK (type IN ('recharge', 'consume', 'refund')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref_type TEXT,
  ref_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. recharge_codes
CREATE TABLE IF NOT EXISTS recharge_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  denomination INTEGER NOT NULL CHECK (denomination > 0),
  status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used', 'voided')),
  used_by UUID REFERENCES user_profiles(id),
  used_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. tasks
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  title TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'uploading',
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  target_words INTEGER NOT NULL DEFAULT 1000,
  citation_style TEXT NOT NULL DEFAULT 'APA 7',
  special_requirements TEXT DEFAULT '',
  outline_edits_used INTEGER NOT NULL DEFAULT 0,
  frozen_credits INTEGER NOT NULL DEFAULT 0,
  failure_stage TEXT,
  failure_reason TEXT,
  refunded BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 硬约束：同一用户只能有一个进行中的任务
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_task_per_user
  ON tasks (user_id) WHERE status = 'processing';

-- 6. task_files
CREATE TABLE IF NOT EXISTS task_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('material', 'final_doc', 'citation_report', 'humanized_doc')),
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. outline_versions
CREATE TABLE IF NOT EXISTS outline_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  edit_instruction TEXT,
  target_words INTEGER NOT NULL DEFAULT 1000,
  citation_style TEXT NOT NULL DEFAULT 'APA 7',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. document_versions
CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  stage TEXT NOT NULL CHECK (stage IN ('draft', 'calibrated', 'verified', 'final')),
  word_count INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. humanize_jobs
CREATE TABLE IF NOT EXISTS humanize_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  input_version_id UUID NOT NULL REFERENCES document_versions(id),
  input_word_count INTEGER NOT NULL DEFAULT 0,
  frozen_credits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  failure_reason TEXT,
  refunded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- 10. task_events
CREATE TABLE IF NOT EXISTS task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  detail JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. system_config
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT DEFAULT ''
);

-- 插入默认配置
INSERT INTO system_config (key, value) VALUES
  ('writing_price_per_1000', '250'),
  ('humanize_price_per_1000', '250'),
  ('result_file_retention_days', '3'),
  ('material_retention_days', '3'),
  ('stuck_task_timeout_minutes', '30'),
  ('max_outline_edits', '4'),
  ('activation_denominations', '[1000, 3000, 10000, 20000]')
ON CONFLICT (key) DO NOTHING;

-- 索引
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_id ON credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_task_files_task_id ON task_files(task_id);
CREATE INDEX IF NOT EXISTS idx_task_files_expires_at ON task_files(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recharge_codes_code ON recharge_codes(code);
CREATE INDEX IF NOT EXISTS idx_outline_versions_task_id ON outline_versions(task_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_task_id ON document_versions(task_id);
CREATE INDEX IF NOT EXISTS idx_humanize_jobs_task_id ON humanize_jobs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);

-- 创建 Storage bucket
-- 注意：这一步需要在 Supabase Dashboard > Storage 中手动创建 bucket "task-files"
-- 或通过 Supabase API 创建
```

**Step 2: 在 Supabase SQL Editor 中执行这份 SQL**

登录 Supabase Dashboard → SQL Editor → 粘贴执行。

**Step 3: 在 Supabase Storage 中创建 bucket**

Dashboard → Storage → New bucket → 名称: `task-files`，设为 Private。

**Step 4: Commit**

```bash
git add server/db/
git commit -m "feat: add database migration SQL with all 11 tables"
```

---

## 阶段 1：账号、余额、充值打通（里程碑 1）

### Task 4: 中间件 — auth + statusGuard + rateLimiter

**Files:**
- Create: `server/src/middleware/auth.ts`
- Create: `server/src/middleware/ops.ts`
- Create: `server/src/middleware/statusGuard.ts`
- Create: `server/src/middleware/rateLimiter.ts`

**Step 1: 创建 auth 中间件**

```typescript
// server/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, '请先登录。');
    }
    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      throw new AppError(401, '登录已过期，请重新登录。');
    }
    req.userId = user.id;
    req.userEmail = user.email;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.userMessage });
    } else {
      res.status(401).json({ success: false, error: '认证失败，请重新登录。' });
    }
  }
}
```

**Step 2: 创建 ops 中间件**

```typescript
// server/src/middleware/ops.ts
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { env } from '../config/env';

export function opsMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userEmail || !env.opsWhitelistEmails.includes(req.userEmail)) {
    res.status(403).json({ success: false, error: '无权限访问运营功能。' });
    return;
  }
  next();
}
```

**Step 3: 创建 statusGuard 中间件**

```typescript
// server/src/middleware/statusGuard.ts
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { supabaseAdmin } from '../lib/supabase';

export async function statusGuard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('status')
      .eq('id', req.userId!)
      .single();

    if (!profile) {
      res.status(403).json({ success: false, error: '账号未初始化，请重新注册或联系客服。' });
      return;
    }
    if (profile.status === 'disabled') {
      res.status(403).json({ success: false, error: '您的账号已被禁用，如有疑问请联系客服。' });
      return;
    }
    next();
  } catch {
    res.status(500).json({ success: false, error: '服务异常，请稍后重试。' });
  }
}
```

**Step 4: 创建 rateLimiter 中间件**

```typescript
// server/src/middleware/rateLimiter.ts
import rateLimit from 'express-rate-limit';

// 注册限频：每个 IP 每小时最多 10 次
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, error: '注册请求过于频繁，请稍后再试。' },
});

// 登录失败限频：每个 IP 每 15 分钟最多 10 次
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: '登录尝试过于频繁，请 15 分钟后再试。' },
});

// 激活码限频：每个 IP 每小时最多 20 次
export const redeemLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { success: false, error: '激活码尝试过于频繁，请稍后再试。' },
});
```

**Step 5: 验证类型检查**

Run: `cd server && npm run lint`

**Step 6: Commit**

```bash
git add server/src/middleware/
git commit -m "feat: add auth, ops, statusGuard, rateLimiter middleware"
```

---

### Task 5: 用户路由 — init + profile

**Files:**
- Create: `server/src/services/userService.ts`
- Create: `server/src/routes/user.ts`
- Modify: `server/src/index.ts` — 挂载路由

**Step 1: 创建 userService.ts**

```typescript
// server/src/services/userService.ts
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';

export async function initUser(userId: string, email: string) {
  // 幂等：如果已存在则不重复创建
  const { data: existing } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('id', userId)
    .single();

  if (existing) {
    return { alreadyExists: true };
  }

  // 事务：创建 profile + wallet
  const { error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .insert({ id: userId, email });

  if (profileError) {
    throw new AppError(500, '账号初始化失败，请稍后重试。', profileError.message);
  }

  const { error: walletError } = await supabaseAdmin
    .from('wallets')
    .insert({ user_id: userId, balance: 0, frozen: 0 });

  if (walletError) {
    // 回滚 profile
    await supabaseAdmin.from('user_profiles').delete().eq('id', userId);
    throw new AppError(500, '账号初始化失败，请稍后重试。', walletError.message);
  }

  return { alreadyExists: false };
}

export async function getProfile(userId: string) {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email, nickname, status, created_at')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    throw new AppError(404, '用户信息不存在，请联系客服。');
  }

  const { data: wallet } = await supabaseAdmin
    .from('wallets')
    .select('balance, frozen')
    .eq('user_id', userId)
    .single();

  // 检查是否有进行中的任务
  const { data: activeTask } = await supabaseAdmin
    .from('tasks')
    .select('id, stage, title')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .single();

  return {
    ...profile,
    balance: wallet?.balance ?? 0,
    frozen: wallet?.frozen ?? 0,
    activeTask: activeTask || null,
  };
}
```

**Step 2: 创建 routes/user.ts**

```typescript
// server/src/routes/user.ts
import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { initUser, getProfile } from '../services/userService';
import { registerLimiter } from '../middleware/rateLimiter';

const router = Router();

// POST /api/user/init
router.post('/init', registerLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const result = await initUser(req.userId!, req.userEmail!);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '服务异常，请稍后重试。' });
  }
});

// GET /api/user/profile
router.get('/profile', async (req: AuthRequest, res: Response) => {
  try {
    const profile = await getProfile(req.userId!);
    res.json({ success: true, data: profile });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '服务异常，请稍后重试。' });
  }
});

export default router;
```

**Step 3: 更新 index.ts 挂载路由**

```typescript
// server/src/index.ts
import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { authMiddleware } from './middleware/auth';
import { statusGuard } from './middleware/statusGuard';
import userRoutes from './routes/user';

const app = express();

app.use(cors());
app.use(express.json());

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 用户路由（需要登录，init 不需要 statusGuard）
app.use('/api/user', authMiddleware, userRoutes);

app.listen(env.port, () => {
  console.log(`Server running on port ${env.port}`);
});

export default app;
```

**Step 4: 验证类型检查**

Run: `cd server && npm run lint`

**Step 5: Commit**

```bash
git add server/src/services/userService.ts server/src/routes/user.ts server/src/index.ts
git commit -m "feat: add user init and profile endpoints"
```

---

### Task 6: 激活码兑换 + 余额查看

**Files:**
- Create: `server/src/services/walletService.ts`
- Create: `server/src/services/rechargeService.ts`
- Create: `server/src/routes/recharge.ts`
- Modify: `server/src/index.ts` — 挂载路由

**Step 1: 创建 walletService.ts**

```typescript
// server/src/services/walletService.ts
import { supabaseAdmin } from '../lib/supabase';
import { AppError, InsufficientBalanceError } from '../lib/errors';

export async function getBalance(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('wallets')
    .select('balance, frozen')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new AppError(404, '钱包不存在，请联系客服。');
  }
  return data;
}

export async function addBalance(userId: string, amount: number, type: 'recharge' | 'refund', refType: string, refId: string, note: string) {
  // 读取当前余额
  const { data: wallet, error: walletError } = await supabaseAdmin
    .from('wallets')
    .select('balance')
    .eq('user_id', userId)
    .single();

  if (walletError || !wallet) {
    throw new AppError(500, '钱包操作失败，请稍后重试。');
  }

  const newBalance = wallet.balance + amount;

  // 更新余额
  const { error: updateError } = await supabaseAdmin
    .from('wallets')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (updateError) {
    throw new AppError(500, '余额更新失败，请稍后重试。');
  }

  // 写流水
  const { error: ledgerError } = await supabaseAdmin
    .from('credit_ledger')
    .insert({
      user_id: userId,
      type,
      amount,
      balance_after: newBalance,
      ref_type: refType,
      ref_id: refId,
      note,
    });

  if (ledgerError) {
    // 尝试回滚余额
    await supabaseAdmin
      .from('wallets')
      .update({ balance: wallet.balance })
      .eq('user_id', userId);
    throw new AppError(500, '流水记录失败，请稍后重试。');
  }

  return { balance: newBalance };
}

export async function freezeCredits(userId: string, amount: number, refType: string, refId: string, note: string) {
  const { data: wallet, error } = await supabaseAdmin
    .from('wallets')
    .select('balance, frozen')
    .eq('user_id', userId)
    .single();

  if (error || !wallet) {
    throw new AppError(500, '钱包操作失败。');
  }

  if (wallet.balance < amount) {
    throw new InsufficientBalanceError();
  }

  const newBalance = wallet.balance - amount;
  const newFrozen = wallet.frozen + amount;

  const { error: updateError } = await supabaseAdmin
    .from('wallets')
    .update({ balance: newBalance, frozen: newFrozen, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (updateError) {
    throw new AppError(500, '积分冻结失败。');
  }

  // 写消费流水
  const { error: ledgerError } = await supabaseAdmin
    .from('credit_ledger')
    .insert({
      user_id: userId,
      type: 'consume',
      amount: -amount,
      balance_after: newBalance,
      ref_type: refType,
      ref_id: refId,
      note,
    });

  if (ledgerError) {
    // 回滚
    await supabaseAdmin
      .from('wallets')
      .update({ balance: wallet.balance, frozen: wallet.frozen })
      .eq('user_id', userId);
    throw new AppError(500, '流水记录失败。');
  }

  return { balance: newBalance, frozen: newFrozen };
}

export async function settleCredits(userId: string, amount: number) {
  const { data: wallet, error } = await supabaseAdmin
    .from('wallets')
    .select('frozen')
    .eq('user_id', userId)
    .single();

  if (error || !wallet) {
    throw new AppError(500, '结算失败。');
  }

  const { error: updateError } = await supabaseAdmin
    .from('wallets')
    .update({ frozen: wallet.frozen - amount, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (updateError) {
    throw new AppError(500, '结算失败。');
  }
}

export async function refundCredits(userId: string, amount: number, refType: string, refId: string, note: string) {
  const { data: wallet, error } = await supabaseAdmin
    .from('wallets')
    .select('balance, frozen')
    .eq('user_id', userId)
    .single();

  if (error || !wallet) {
    throw new AppError(500, '退款失败。');
  }

  const newBalance = wallet.balance + amount;
  const newFrozen = wallet.frozen - amount;

  const { error: updateError } = await supabaseAdmin
    .from('wallets')
    .update({ balance: newBalance, frozen: newFrozen, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (updateError) {
    throw new AppError(500, '退款失败。');
  }

  const { error: ledgerError } = await supabaseAdmin
    .from('credit_ledger')
    .insert({
      user_id: userId,
      type: 'refund',
      amount,
      balance_after: newBalance,
      ref_type: refType,
      ref_id: refId,
      note,
    });

  if (ledgerError) {
    // 回滚
    await supabaseAdmin
      .from('wallets')
      .update({ balance: wallet.balance, frozen: wallet.frozen })
      .eq('user_id', userId);
    throw new AppError(500, '退款流水记录失败。');
  }

  return { balance: newBalance, frozen: newFrozen };
}

export async function getLedger(userId: string, limit = 20, offset = 0) {
  const { data, error, count } = await supabaseAdmin
    .from('credit_ledger')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new AppError(500, '获取记录失败。');
  }

  return { records: data || [], total: count || 0 };
}
```

**Step 2: 创建 rechargeService.ts**

```typescript
// server/src/services/rechargeService.ts
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { addBalance } from './walletService';

export async function redeemCode(userId: string, code: string) {
  // 查找激活码
  const { data: codeRecord, error } = await supabaseAdmin
    .from('recharge_codes')
    .select('*')
    .eq('code', code.trim())
    .single();

  if (error || !codeRecord) {
    throw new AppError(400, '激活码不存在，请检查输入是否正确。');
  }

  if (codeRecord.status === 'used') {
    throw new AppError(400, '该激活码已被使用。');
  }

  if (codeRecord.status === 'voided') {
    throw new AppError(400, '该激活码已失效。');
  }

  // 标记激活码为已使用
  const { error: updateError } = await supabaseAdmin
    .from('recharge_codes')
    .update({
      status: 'used',
      used_by: userId,
      used_at: new Date().toISOString(),
    })
    .eq('id', codeRecord.id)
    .eq('status', 'unused'); // 乐观锁

  if (updateError) {
    throw new AppError(500, '兑换失败，请稍后重试。');
  }

  // 加余额 + 写流水
  const result = await addBalance(
    userId,
    codeRecord.denomination,
    'recharge',
    'recharge_code',
    codeRecord.id,
    `兑换激活码 ${codeRecord.denomination} 积分`,
  );

  return {
    denomination: codeRecord.denomination,
    balance: result.balance,
  };
}
```

**Step 3: 创建 routes/recharge.ts**

```typescript
// server/src/routes/recharge.ts
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
```

**Step 4: 更新 index.ts 挂载路由**

在 index.ts 中添加：
```typescript
import rechargeRoutes from './routes/recharge';
// ...
app.use('/api/recharge', authMiddleware, rechargeRoutes);
```

**Step 5: 验证类型检查**

Run: `cd server && npm run lint`

**Step 6: Commit**

```bash
git add server/src/services/walletService.ts server/src/services/rechargeService.ts server/src/routes/recharge.ts server/src/index.ts
git commit -m "feat: add wallet service, activation code redemption, and balance history"
```

---

## 阶段 2：任务创建和大纲闭环（里程碑 2）

### Task 7: 文件上传 + 任务创建

**Files:**
- Create: `server/src/services/fileService.ts`
- Create: `server/src/services/taskService.ts`
- Create: `server/src/routes/task.ts`
- Modify: `server/src/index.ts`

**Step 1: 创建 fileService.ts**

```typescript
// server/src/services/fileService.ts
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE, MAX_TOTAL_SIZE, MAX_FILES_PER_TASK } from '../types';
import path from 'path';

export function validateFiles(files: Express.Multer.File[]) {
  if (files.length === 0) {
    throw new AppError(400, '请至少上传一个文件。');
  }
  if (files.length > MAX_FILES_PER_TASK) {
    throw new AppError(400, `最多上传 ${MAX_FILES_PER_TASK} 个文件。`);
  }

  let totalSize = 0;
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (!ALLOWED_FILE_TYPES.includes(ext)) {
      throw new AppError(400, `不支持的文件格式：${ext}。支持的格式：${ALLOWED_FILE_TYPES.join(', ')}。`);
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new AppError(400, `文件 ${file.originalname} 超过 20MB 大小限制。`);
    }
    totalSize += file.size;
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    throw new AppError(400, '文件总大小超过 50MB 限制。');
  }
}

export async function uploadFiles(taskId: string, files: Express.Multer.File[]) {
  const records = [];

  for (const file of files) {
    const storagePath = `${taskId}/${Date.now()}-${file.originalname}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('task-files')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      throw new AppError(500, `文件 ${file.originalname} 上传失败，请稍后重试。`);
    }

    const { error: dbError } = await supabaseAdmin
      .from('task_files')
      .insert({
        task_id: taskId,
        category: 'material',
        original_name: file.originalname,
        storage_path: storagePath,
        file_size: file.size,
        mime_type: file.mimetype,
      });

    if (dbError) {
      throw new AppError(500, `文件记录保存失败。`);
    }

    records.push({ name: file.originalname, size: file.size });
  }

  return records;
}

export async function getDownloadUrl(taskId: string, fileId: string, userId: string) {
  // 验证文件归属
  const { data: file } = await supabaseAdmin
    .from('task_files')
    .select('*, tasks!inner(user_id)')
    .eq('id', fileId)
    .eq('task_id', taskId)
    .single();

  if (!file || (file as any).tasks.user_id !== userId) {
    throw new AppError(404, '文件不存在。');
  }

  if (file.expires_at && new Date(file.expires_at) < new Date()) {
    throw new AppError(410, '文件已过期，无法下载。');
  }

  const { data, error } = await supabaseAdmin.storage
    .from('task-files')
    .createSignedUrl(file.storage_path, 3600); // 1小时有效

  if (error || !data) {
    throw new AppError(500, '生成下载链接失败。');
  }

  return { url: data.signedUrl, filename: file.original_name };
}

export async function deleteExpiredFiles() {
  const { data: expiredFiles } = await supabaseAdmin
    .from('task_files')
    .select('id, storage_path')
    .lt('expires_at', new Date().toISOString());

  if (!expiredFiles || expiredFiles.length === 0) return 0;

  for (const file of expiredFiles) {
    await supabaseAdmin.storage.from('task-files').remove([file.storage_path]);
    await supabaseAdmin.from('task_files').delete().eq('id', file.id);
  }

  return expiredFiles.length;
}
```

**Step 2: 创建 taskService.ts**

```typescript
// server/src/services/taskService.ts
import { supabaseAdmin } from '../lib/supabase';
import { AppError, ActiveTaskExistsError } from '../lib/errors';

export async function createTask(userId: string, title: string, specialRequirements: string) {
  // 检查是否已有进行中任务
  const { data: activeTask } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .single();

  if (activeTask) {
    throw new ActiveTaskExistsError();
  }

  const { data: task, error } = await supabaseAdmin
    .from('tasks')
    .insert({
      user_id: userId,
      title: title || '未命名任务',
      stage: 'uploading',
      status: 'processing',
      special_requirements: specialRequirements || '',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new ActiveTaskExistsError();
    }
    throw new AppError(500, '创建任务失败，请稍后重试。');
  }

  return task;
}

export async function getTask(taskId: string, userId: string) {
  const { data: task, error } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (error || !task) {
    throw new AppError(404, '任务不存在。');
  }

  // 获取关联数据
  const [files, outlines, latestDoc, humanizeJobs] = await Promise.all([
    supabaseAdmin.from('task_files').select('*').eq('task_id', taskId).order('created_at'),
    supabaseAdmin.from('outline_versions').select('*').eq('task_id', taskId).order('version'),
    supabaseAdmin.from('document_versions').select('*').eq('task_id', taskId).order('version', { ascending: false }).limit(1),
    supabaseAdmin.from('humanize_jobs').select('*').eq('task_id', taskId).order('created_at', { ascending: false }),
  ]);

  return {
    ...task,
    files: files.data || [],
    outlines: outlines.data || [],
    latestDocument: latestDoc.data?.[0] || null,
    humanizeJobs: humanizeJobs.data || [],
  };
}

export async function getCurrentTask(userId: string) {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .single();

  if (!task) {
    return null;
  }

  return getTask(task.id, userId);
}

export async function getTaskList(userId: string, status?: string, limit = 20, offset = 0) {
  let query = supabaseAdmin
    .from('tasks')
    .select('id, title, stage, status, target_words, failure_stage, failure_reason, refunded, created_at, completed_at, updated_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new AppError(500, '获取任务列表失败。');
  }

  return { tasks: data || [], total: count || 0 };
}

export async function updateTaskStage(taskId: string, stage: string, extraFields: Record<string, any> = {}) {
  const { error } = await supabaseAdmin
    .from('tasks')
    .update({ stage, updated_at: new Date().toISOString(), ...extraFields })
    .eq('id', taskId);

  if (error) {
    throw new AppError(500, '任务状态更新失败。');
  }
}

export async function failTask(taskId: string, failureStage: string, failureReason: string, refunded: boolean) {
  const { error } = await supabaseAdmin
    .from('tasks')
    .update({
      status: 'failed',
      failure_stage: failureStage,
      failure_reason: failureReason,
      refunded,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    throw new AppError(500, '任务状态更新失败。');
  }

  // 写事件日志
  await supabaseAdmin.from('task_events').insert({
    task_id: taskId,
    event_type: 'task_failed',
    detail: { stage: failureStage, reason: failureReason, refunded },
  });
}

export async function completeTask(taskId: string) {
  const { error } = await supabaseAdmin
    .from('tasks')
    .update({
      status: 'completed',
      stage: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    throw new AppError(500, '任务完成状态更新失败。');
  }
}
```

**Step 3: 创建 routes/task.ts（第一部分：创建、查询、下载）**

```typescript
// server/src/routes/task.ts
import { Router, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import { statusGuard } from '../middleware/statusGuard';
import { createTask, getTask, getCurrentTask, getTaskList } from '../services/taskService';
import { validateFiles, uploadFiles, getDownloadUrl } from '../services/fileService';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

// 所有 task 路由都需要 statusGuard
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
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '创建任务失败。' });
  }
});

// GET /api/task/current
router.get('/current', async (req: AuthRequest, res: Response) => {
  try {
    const task = await getCurrentTask(req.userId!);
    res.json({ success: true, data: task });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '获取任务失败。' });
  }
});

// GET /api/task/list
router.get('/list', async (req: AuthRequest, res: Response) => {
  try {
    const { status, limit, offset } = req.query;
    const result = await getTaskList(
      req.userId!,
      status as string | undefined,
      Math.min(parseInt(limit as string) || 20, 100),
      parseInt(offset as string) || 0,
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '获取任务列表失败。' });
  }
});

// GET /api/task/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const task = await getTask(req.params.id, req.userId!);
    res.json({ success: true, data: task });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '获取任务失败。' });
  }
});

// GET /api/task/:id/file/:fileId/download
router.get('/:id/file/:fileId/download', async (req: AuthRequest, res: Response) => {
  try {
    const result = await getDownloadUrl(req.params.id, req.params.fileId, req.userId!);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '下载失败。' });
  }
});

export default router;
```

**Step 4: 更新 index.ts**

```typescript
import taskRoutes from './routes/task';
// ...
app.use('/api/task', authMiddleware, taskRoutes);
```

**Step 5: 验证类型检查**

Run: `cd server && npm run lint`

**Step 6: Commit**

```bash
git add server/src/services/fileService.ts server/src/services/taskService.ts server/src/routes/task.ts server/src/index.ts
git commit -m "feat: add task creation, file upload, task query and download endpoints"
```

---

### Task 8: 大纲生成 + 修改 + 确认

**Files:**
- Create: `server/src/services/outlineService.ts`
- Create: `server/src/services/configService.ts`
- Modify: `server/src/routes/task.ts` — 添加大纲路由

**Step 1: 创建 configService.ts**

```typescript
// server/src/services/configService.ts
import { supabaseAdmin } from '../lib/supabase';

export async function getConfig(key: string): Promise<any> {
  const { data } = await supabaseAdmin
    .from('system_config')
    .select('value')
    .eq('key', key)
    .single();
  return data?.value ?? null;
}

export async function getAllConfig() {
  const { data } = await supabaseAdmin
    .from('system_config')
    .select('key, value, updated_at');
  return data || [];
}

export async function setConfig(key: string, value: any, updatedBy: string) {
  const { error } = await supabaseAdmin
    .from('system_config')
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    });
  if (error) throw error;
}
```

**Step 2: 创建 outlineService.ts**

```typescript
// server/src/services/outlineService.ts
import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { updateTaskStage, failTask } from './taskService';
import { freezeCredits } from './walletService';
import { getConfig } from './configService';

export async function generateOutline(taskId: string, userId: string) {
  // 读取材料
  const { data: files } = await supabaseAdmin
    .from('task_files')
    .select('original_name, storage_path, mime_type')
    .eq('task_id', taskId)
    .eq('category', 'material');

  if (!files || files.length === 0) {
    await failTask(taskId, 'outline_generating', '没有找到上传的材料文件。', false);
    throw new AppError(400, '没有找到上传的材料文件，请重新创建任务。');
  }

  // 获取任务信息
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('special_requirements')
    .eq('id', taskId)
    .single();

  // 下载并读取材料内容
  const materialTexts: string[] = [];
  for (const file of files) {
    try {
      const { data: fileData } = await supabaseAdmin.storage
        .from('task-files')
        .download(file.storage_path);
      if (fileData) {
        const text = await fileData.text();
        materialTexts.push(`--- ${file.original_name} ---\n${text}`);
      }
    } catch {
      materialTexts.push(`--- ${file.original_name} --- (无法解析)`);
    }
  }

  await updateTaskStage(taskId, 'outline_generating');

  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: [
        {
          role: 'system',
          content: `You are an academic writing assistant. Based on the provided materials, generate a detailed English outline for an academic paper. Also identify:
1. Target word count (default 1000 if unclear)
2. Citation style (default APA 7 if unclear)

Respond in JSON format:
{
  "outline": "the full outline text",
  "target_words": number,
  "citation_style": "string"
}`,
        },
        {
          role: 'user',
          content: `Materials:\n${materialTexts.join('\n\n')}\n\nSpecial requirements: ${task?.special_requirements || 'None'}`,
        },
      ],
    });

    const content = typeof response.output_text === 'string' ? response.output_text : '';

    let parsed: { outline: string; target_words: number; citation_style: string };
    try {
      // 尝试解析 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      parsed = { outline: content, target_words: 1000, citation_style: 'APA 7' };
    }

    const targetWords = parsed.target_words || 1000;
    const citationStyle = parsed.citation_style || 'APA 7';

    // 保存大纲版本
    const { data: outline, error } = await supabaseAdmin
      .from('outline_versions')
      .insert({
        task_id: taskId,
        version: 1,
        content: parsed.outline,
        target_words: targetWords,
        citation_style: citationStyle,
      })
      .select()
      .single();

    if (error) {
      throw new Error('保存大纲失败');
    }

    // 更新任务
    await updateTaskStage(taskId, 'outline_ready', {
      target_words: targetWords,
      citation_style: citationStyle,
    });

    // 写事件
    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'outline_generated',
      detail: { version: 1, target_words: targetWords, citation_style: citationStyle },
    });

    return outline;
  } catch (err: any) {
    await failTask(taskId, 'outline_generating', '大纲生成失败，请重新创建任务。AI 返回异常。', false);
    throw new AppError(500, '大纲生成失败，请重新创建任务。');
  }
}

export async function regenerateOutline(taskId: string, userId: string, editInstruction: string) {
  // 获取任务
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) {
    throw new AppError(404, '任务不存在。');
  }
  if (task.stage !== 'outline_ready') {
    throw new AppError(400, '当前阶段无法修改大纲。');
  }

  const maxEdits = (await getConfig('max_outline_edits')) || 4;
  if (task.outline_edits_used >= maxEdits) {
    throw new AppError(400, `大纲修改次数已用完（最多 ${maxEdits} 次）。`);
  }

  // 获取最新大纲
  const { data: latestOutline } = await supabaseAdmin
    .from('outline_versions')
    .select('*')
    .eq('task_id', taskId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (!latestOutline) {
    throw new AppError(500, '找不到当前大纲。');
  }

  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: [
        {
          role: 'system',
          content: `You are an academic writing assistant. Revise the existing outline based on the user's feedback. Keep the same JSON format:
{
  "outline": "revised outline text",
  "target_words": number,
  "citation_style": "string"
}`,
        },
        {
          role: 'user',
          content: `Current outline:\n${latestOutline.content}\n\nCurrent target words: ${latestOutline.target_words}\nCurrent citation style: ${latestOutline.citation_style}\n\nRevision request: ${editInstruction}`,
        },
      ],
    });

    const content = typeof response.output_text === 'string' ? response.output_text : '';
    let parsed: { outline: string; target_words: number; citation_style: string };
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      parsed = {
        outline: content,
        target_words: latestOutline.target_words,
        citation_style: latestOutline.citation_style,
      };
    }

    const newVersion = latestOutline.version + 1;

    const { data: outline } = await supabaseAdmin
      .from('outline_versions')
      .insert({
        task_id: taskId,
        version: newVersion,
        content: parsed.outline,
        edit_instruction: editInstruction,
        target_words: parsed.target_words || latestOutline.target_words,
        citation_style: parsed.citation_style || latestOutline.citation_style,
      })
      .select()
      .single();

    // 更新修改次数
    await supabaseAdmin
      .from('tasks')
      .update({
        outline_edits_used: task.outline_edits_used + 1,
        target_words: parsed.target_words || latestOutline.target_words,
        citation_style: parsed.citation_style || latestOutline.citation_style,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    return outline;
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, '大纲修改失败，请稍后重试。');
  }
}

export async function confirmOutline(taskId: string, userId: string, targetWords?: number, citationStyle?: string) {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) throw new AppError(404, '任务不存在。');
  if (task.stage !== 'outline_ready') throw new AppError(400, '请先等待大纲生成完成。');

  // 获取最新大纲
  const { data: latestOutline } = await supabaseAdmin
    .from('outline_versions')
    .select('*')
    .eq('task_id', taskId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (!latestOutline) throw new AppError(500, '找不到大纲。');

  const finalWords = targetWords || latestOutline.target_words || 1000;
  const finalStyle = citationStyle || latestOutline.citation_style || 'APA 7';

  // 计算费用
  const pricePerThousand = (await getConfig('writing_price_per_1000')) || 250;
  const units = Math.ceil(finalWords / 1000);
  const cost = units * pricePerThousand;

  // 冻结积分
  await freezeCredits(userId, cost, 'task', taskId, `正文生成：${finalWords} 词，${cost} 积分`);

  // 更新任务
  await supabaseAdmin
    .from('tasks')
    .update({
      stage: 'writing',
      target_words: finalWords,
      citation_style: finalStyle,
      frozen_credits: cost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  // 写事件
  await supabaseAdmin.from('task_events').insert({
    task_id: taskId,
    event_type: 'outline_confirmed',
    detail: { target_words: finalWords, citation_style: finalStyle, frozen_credits: cost },
  });

  return { taskId, stage: 'writing', frozenCredits: cost };
}
```

**Step 3: 在 routes/task.ts 添加大纲相关路由**

在 task router 中添加：

```typescript
import { generateOutline, regenerateOutline, confirmOutline } from '../services/outlineService';

// POST /api/task/:id/outline/regenerate
router.post('/:id/outline/regenerate', async (req: AuthRequest, res: Response) => {
  try {
    const { editInstruction } = req.body;
    if (!editInstruction) {
      res.status(400).json({ success: false, error: '请输入修改意见。' });
      return;
    }
    const outline = await regenerateOutline(req.params.id, req.userId!, editInstruction);
    res.json({ success: true, data: outline });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '大纲修改失败。' });
  }
});

// POST /api/task/:id/outline/confirm
router.post('/:id/outline/confirm', async (req: AuthRequest, res: Response) => {
  try {
    const { targetWords, citationStyle } = req.body;
    const result = await confirmOutline(req.params.id, req.userId!, targetWords, citationStyle);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '确认大纲失败。' });
  }
});
```

同时更新 `POST /api/task/create` 的尾部，在文件上传后自动触发大纲生成：

```typescript
// 在 createTask 路由最后，文件上传完成后
await uploadFiles(task.id, files);

// 异步启动大纲生成（不阻塞响应）
generateOutline(task.id, req.userId!).catch(err => {
  console.error(`Outline generation failed for task ${task.id}:`, err);
});

res.json({ success: true, data: task });
```

**Step 4: 验证类型检查**

Run: `cd server && npm run lint`

**Step 5: Commit**

```bash
git add server/src/services/outlineService.ts server/src/services/configService.ts server/src/routes/task.ts
git commit -m "feat: add outline generation, editing, and confirmation with credit freezing"
```

---

## 阶段 3：正文主流程闭环（里程碑 3）

### Task 9: 正文生成 + 字数矫正 + 引用核验 + 交付

**Files:**
- Create: `server/src/services/writingService.ts`

**Step 1: 创建 writingService.ts**

```typescript
// server/src/services/writingService.ts
import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { updateTaskStage, failTask, completeTask } from './taskService';
import { settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import { Document, Packer, Paragraph, TextRun } from 'docx';

export async function startWritingPipeline(taskId: string, userId: string) {
  try {
    // 获取任务和大纲
    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (!task) throw new Error('Task not found');

    const { data: latestOutline } = await supabaseAdmin
      .from('outline_versions')
      .select('*')
      .eq('task_id', taskId)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (!latestOutline) throw new Error('Outline not found');

    // === 第 1 步：正文生成 ===
    await updateTaskStage(taskId, 'writing');
    const draft = await generateDraft(taskId, latestOutline.content, task.target_words, task.citation_style, task.special_requirements);

    // === 第 2 步：字数矫正 ===
    await updateTaskStage(taskId, 'word_calibrating');
    const calibrated = await calibrateWordCount(taskId, draft, task.target_words);

    // === 第 3 步：引用核验 ===
    await updateTaskStage(taskId, 'citation_checking');
    const verified = await verifyCitations(taskId, calibrated, task.citation_style);

    // === 第 4 步：交付整理 ===
    await updateTaskStage(taskId, 'delivering');
    await deliverResults(taskId, userId, verified, task);

    // 成功：结算冻结积分
    await settleCredits(userId, task.frozen_credits);
    await completeTask(taskId);

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'writing_completed',
      detail: { frozen_credits: task.frozen_credits },
    });

  } catch (err: any) {
    console.error(`Writing pipeline failed for task ${taskId}:`, err);

    // 获取任务信息进行退款
    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('user_id, frozen_credits, stage')
      .eq('id', taskId)
      .single();

    if (task && task.frozen_credits > 0) {
      try {
        await refundCredits(task.user_id, task.frozen_credits, 'task', taskId, `正文生成失败退款：${task.frozen_credits} 积分`);
        await failTask(taskId, task.stage, '正文生成过程中出现问题，积分已自动退回。请重新创建任务。', true);
      } catch (refundErr) {
        console.error(`Refund failed for task ${taskId}:`, refundErr);
        await failTask(taskId, task.stage, '正文生成失败，退款异常，请联系客服处理。', false);
      }
    } else {
      await failTask(taskId, 'writing', '正文生成失败。', false);
    }
  }
}

async function generateDraft(taskId: string, outline: string, targetWords: number, citationStyle: string, requirements: string): Promise<string> {
  const response = await openai.responses.create({
    model: 'gpt-4.1',
    input: [
      {
        role: 'system',
        content: `You are an academic writing expert. Write a complete English academic paper based on the provided outline. Requirements:
- Target word count: approximately ${targetWords} words
- Citation style: ${citationStyle}
- Write only the paper content, no meta-commentary
- Include proper citations and references section`,
      },
      {
        role: 'user',
        content: `Outline:\n${outline}\n\nAdditional requirements: ${requirements || 'None'}`,
      },
    ],
  });

  const content = typeof response.output_text === 'string' ? response.output_text : '';
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: 1,
    stage: 'draft',
    word_count: wordCount,
    content,
  });

  await supabaseAdmin.from('task_events').insert({
    task_id: taskId,
    event_type: 'draft_generated',
    detail: { word_count: wordCount },
  });

  return content;
}

async function calibrateWordCount(taskId: string, draft: string, targetWords: number): Promise<string> {
  const currentWords = draft.split(/\s+/).filter(Boolean).length;
  const tolerance = 0.1; // 10% 容差

  if (Math.abs(currentWords - targetWords) / targetWords <= tolerance) {
    // 字数在容差范围内，直接通过
    await supabaseAdmin.from('document_versions').insert({
      task_id: taskId,
      version: 2,
      stage: 'calibrated',
      word_count: currentWords,
      content: draft,
    });
    return draft;
  }

  // 需要调整字数
  const response = await openai.responses.create({
    model: 'gpt-4.1',
    input: [
      {
        role: 'system',
        content: `You are an academic writing editor. The current paper has ${currentWords} words but the target is ${targetWords} words. ${currentWords < targetWords ? 'Expand' : 'Condense'} the paper to approximately ${targetWords} words while maintaining quality and coherence. Output only the revised paper.`,
      },
      {
        role: 'user',
        content: draft,
      },
    ],
  });

  const calibrated = typeof response.output_text === 'string' ? response.output_text : draft;
  const newWordCount = calibrated.split(/\s+/).filter(Boolean).length;

  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: 2,
    stage: 'calibrated',
    word_count: newWordCount,
    content: calibrated,
  });

  return calibrated;
}

async function verifyCitations(taskId: string, text: string, citationStyle: string): Promise<string> {
  const response = await openai.responses.create({
    model: 'gpt-4.1',
    input: [
      {
        role: 'system',
        content: `You are a citation verification expert. Review the paper and ensure all citations follow ${citationStyle} format. Fix any formatting issues. Output the corrected paper text only.`,
      },
      {
        role: 'user',
        content: text,
      },
    ],
  });

  const verified = typeof response.output_text === 'string' ? response.output_text : text;
  const wordCount = verified.split(/\s+/).filter(Boolean).length;

  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: 3,
    stage: 'verified',
    word_count: wordCount,
    content: verified,
  });

  return verified;
}

async function deliverResults(taskId: string, userId: string, finalText: string, task: any) {
  const wordCount = finalText.split(/\s+/).filter(Boolean).length;
  const retentionDays = (await getConfig('result_file_retention_days')) || 3;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + retentionDays);

  // 保存最终版本
  await supabaseAdmin.from('document_versions').insert({
    task_id: taskId,
    version: 4,
    stage: 'final',
    word_count: wordCount,
    content: finalText,
  });

  // 生成 .docx 文件
  const doc = new Document({
    sections: [{
      properties: {},
      children: finalText.split('\n').map(line =>
        new Paragraph({
          children: [new TextRun(line)],
        })
      ),
    }],
  });

  const docBuffer = await Packer.toBuffer(doc);
  const docPath = `${taskId}/final-paper.docx`;

  await supabaseAdmin.storage
    .from('task-files')
    .upload(docPath, docBuffer, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

  await supabaseAdmin.from('task_files').insert({
    task_id: taskId,
    category: 'final_doc',
    original_name: 'final-paper.docx',
    storage_path: docPath,
    file_size: docBuffer.length,
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    expires_at: expiresAt.toISOString(),
  });

  // 生成引用报告
  const citationReport = await generateCitationReport(finalText, task.citation_style);
  const reportBuffer = Buffer.from(citationReport, 'utf-8');
  const reportPath = `${taskId}/citation-report.txt`;

  await supabaseAdmin.storage
    .from('task-files')
    .upload(reportPath, reportBuffer, { contentType: 'text/plain' });

  await supabaseAdmin.from('task_files').insert({
    task_id: taskId,
    category: 'citation_report',
    original_name: 'citation-report.txt',
    storage_path: reportPath,
    file_size: reportBuffer.length,
    mime_type: 'text/plain',
    expires_at: expiresAt.toISOString(),
  });
}

async function generateCitationReport(text: string, citationStyle: string): Promise<string> {
  const response = await openai.responses.create({
    model: 'gpt-4.1',
    input: [
      {
        role: 'system',
        content: `You are a citation verification expert. Analyze the paper and generate a citation verification report. List each citation found, whether it follows ${citationStyle} format correctly, and any issues. Output as plain text report.`,
      },
      {
        role: 'user',
        content: text,
      },
    ],
  });

  return typeof response.output_text === 'string' ? response.output_text : 'Citation report generation failed.';
}
```

**Step 2: 在 outlineService.ts 的 confirmOutline 函数最后触发正文流水线**

```typescript
import { startWritingPipeline } from './writingService';

// confirmOutline 函数最后添加：
// 异步启动正文生成（不阻塞响应）
startWritingPipeline(taskId, userId).catch(err => {
  console.error(`Writing pipeline failed for task ${taskId}:`, err);
});

return { taskId, stage: 'writing', frozenCredits: cost };
```

**Step 3: 验证类型检查**

Run: `cd server && npm run lint`

**Step 4: Commit**

```bash
git add server/src/services/writingService.ts server/src/services/outlineService.ts
git commit -m "feat: add complete writing pipeline - draft, calibration, citation verification, delivery"
```

---

## 阶段 4：降 AI、运营、清理（里程碑 4）

### Task 10: 降 AI 功能

**Files:**
- Create: `server/src/services/humanizeService.ts`
- Modify: `server/src/routes/task.ts` — 添加 humanize 路由

**Step 1: 创建 humanizeService.ts**

```typescript
// server/src/services/humanizeService.ts
import { openai } from '../lib/openai';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { freezeCredits, settleCredits, refundCredits } from './walletService';
import { getConfig } from './configService';
import { Document, Packer, Paragraph, TextRun } from 'docx';

export async function startHumanize(taskId: string, userId: string) {
  // 检查任务状态
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) throw new AppError(404, '任务不存在。');
  if (task.status !== 'completed') throw new AppError(400, '只有已完成的任务才能发起降 AI。');

  // 检查是否有降 AI 在处理中
  const { data: pendingJob } = await supabaseAdmin
    .from('humanize_jobs')
    .select('id')
    .eq('task_id', taskId)
    .eq('status', 'processing')
    .single();

  if (pendingJob) throw new AppError(400, '当前已有降 AI 任务在处理中，请等待完成。');

  // 确定输入版本
  const { data: lastSuccessJob } = await supabaseAdmin
    .from('humanize_jobs')
    .select('id')
    .eq('task_id', taskId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  let inputVersion;
  if (lastSuccessJob) {
    // 使用上次成功降 AI 的输出版本（即 humanized_doc 对应的 document_version）
    const { data: humanizedDoc } = await supabaseAdmin
      .from('document_versions')
      .select('*')
      .eq('task_id', taskId)
      .eq('stage', 'final')
      .order('version', { ascending: false })
      .limit(1)
      .single();
    inputVersion = humanizedDoc;
  } else {
    // 第一次：使用原始最终正文
    const { data: finalDoc } = await supabaseAdmin
      .from('document_versions')
      .select('*')
      .eq('task_id', taskId)
      .eq('stage', 'final')
      .order('version', { ascending: true })
      .limit(1)
      .single();
    inputVersion = finalDoc;
  }

  if (!inputVersion) throw new AppError(500, '找不到可用的正文版本。');

  const inputWordCount = inputVersion.word_count;
  const pricePerThousand = (await getConfig('humanize_price_per_1000')) || 250;
  const units = Math.ceil(inputWordCount / 1000);
  const cost = units * pricePerThousand;

  // 冻结积分
  const { data: job } = await supabaseAdmin
    .from('humanize_jobs')
    .insert({
      task_id: taskId,
      input_version_id: inputVersion.id,
      input_word_count: inputWordCount,
      frozen_credits: cost,
      status: 'processing',
    })
    .select()
    .single();

  if (!job) throw new AppError(500, '创建降 AI 任务失败。');

  await freezeCredits(userId, cost, 'humanize_job', job.id, `降 AI：${inputWordCount} 词，${cost} 积分`);

  // 更新任务状态
  await supabaseAdmin
    .from('tasks')
    .update({ stage: 'humanizing', updated_at: new Date().toISOString() })
    .eq('id', taskId);

  // 异步执行
  executeHumanize(taskId, userId, job.id, inputVersion.content, inputWordCount, cost).catch(err => {
    console.error(`Humanize failed for job ${job.id}:`, err);
  });

  return { jobId: job.id, stage: 'humanizing', frozenCredits: cost };
}

async function executeHumanize(taskId: string, userId: string, jobId: string, inputText: string, wordCount: number, frozenCredits: number) {
  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: [
        {
          role: 'system',
          content: `You are a writing humanization expert. Rewrite the following academic paper to reduce AI detection signals while maintaining the same content, arguments, and academic quality. Make the writing style more natural and human-like. Preserve all citations and references. Output only the rewritten paper.`,
        },
        {
          role: 'user',
          content: inputText,
        },
      ],
    });

    const humanized = typeof response.output_text === 'string' ? response.output_text : '';
    const newWordCount = humanized.split(/\s+/).filter(Boolean).length;

    // 保存新版本
    const { data: newVersion } = await supabaseAdmin
      .from('document_versions')
      .insert({
        task_id: taskId,
        version: 100 + Math.floor(Date.now() / 1000), // 降 AI 版本用大数避免冲突
        stage: 'final',
        word_count: newWordCount,
        content: humanized,
      })
      .select()
      .single();

    // 生成 .docx
    const retentionDays = (await getConfig('result_file_retention_days')) || 3;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + retentionDays);

    const doc = new Document({
      sections: [{
        properties: {},
        children: humanized.split('\n').map(line =>
          new Paragraph({ children: [new TextRun(line)] })
        ),
      }],
    });

    const docBuffer = await Packer.toBuffer(doc);
    const docPath = `${taskId}/humanized-${Date.now()}.docx`;

    await supabaseAdmin.storage
      .from('task-files')
      .upload(docPath, docBuffer, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    await supabaseAdmin.from('task_files').insert({
      task_id: taskId,
      category: 'humanized_doc',
      original_name: `humanized-paper.docx`,
      storage_path: docPath,
      file_size: docBuffer.length,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      expires_at: expiresAt.toISOString(),
    });

    // 结算
    await settleCredits(userId, frozenCredits);
    await supabaseAdmin.from('humanize_jobs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);

    // 任务回到 completed
    await supabaseAdmin.from('tasks').update({
      stage: 'completed',
      updated_at: new Date().toISOString(),
    }).eq('id', taskId);

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'humanize_completed',
      detail: { job_id: jobId, word_count: newWordCount },
    });

  } catch (err: any) {
    // 退款
    try {
      await refundCredits(userId, frozenCredits, 'humanize_job', jobId, `降 AI 失败退款：${frozenCredits} 积分`);
      await supabaseAdmin.from('humanize_jobs').update({
        status: 'failed',
        failure_reason: '降 AI 处理失败，积分已退回。',
        refunded: true,
      }).eq('id', jobId);
    } catch {
      await supabaseAdmin.from('humanize_jobs').update({
        status: 'failed',
        failure_reason: '降 AI 失败且退款异常，请联系客服。',
        refunded: false,
      }).eq('id', jobId);
    }

    // 任务回到 completed（不破坏主任务）
    await supabaseAdmin.from('tasks').update({
      stage: 'completed',
      updated_at: new Date().toISOString(),
    }).eq('id', taskId);

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'humanize_failed',
      detail: { job_id: jobId, error: err.message },
    });
  }
}
```

**Step 2: 在 routes/task.ts 添加 humanize 路由**

```typescript
import { startHumanize } from '../services/humanizeService';

// POST /api/task/:id/humanize
router.post('/:id/humanize', async (req: AuthRequest, res: Response) => {
  try {
    const result = await startHumanize(req.params.id, req.userId!);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.userMessage || '降 AI 启动失败。' });
  }
});
```

**Step 3: 验证 + Commit**

Run: `cd server && npm run lint`

```bash
git add server/src/services/humanizeService.ts server/src/routes/task.ts
git commit -m "feat: add humanize (AI reduction) service with credit freeze/settle/refund"
```

---

### Task 11: 运营端 API

**Files:**
- Create: `server/src/routes/ops.ts`
- Modify: `server/src/index.ts`

**Step 1: 创建 routes/ops.ts**

```typescript
// server/src/routes/ops.ts
import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabase';
import { getAllConfig, setConfig } from '../services/configService';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// GET /api/ops/users
router.get('/users', async (_req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select(`
        id, email, nickname, status, created_at,
        wallets(balance, frozen)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // 检查每个用户是否有进行中任务
    const users = await Promise.all((data || []).map(async (user: any) => {
      const { data: activeTask } = await supabaseAdmin
        .from('tasks')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'processing')
        .single();

      return {
        ...user,
        balance: user.wallets?.[0]?.balance ?? 0,
        frozen: user.wallets?.[0]?.frozen ?? 0,
        hasActiveTask: !!activeTask,
      };
    }));

    res.json({ success: true, data: users });
  } catch (err: any) {
    res.status(500).json({ success: false, error: '获取用户列表失败。' });
  }
});

// POST /api/ops/users/:id/disable
router.post('/users/:id/disable', async (req: AuthRequest, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('user_profiles')
      .update({ status: 'disabled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: '操作失败。' });
  }
});

// POST /api/ops/users/:id/enable
router.post('/users/:id/enable', async (req: AuthRequest, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('user_profiles')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: '操作失败。' });
  }
});

// POST /api/ops/codes/generate
router.post('/codes/generate', async (req: AuthRequest, res: Response) => {
  try {
    const { denomination, count } = req.body;
    if (!denomination || !count || count < 1 || count > 100) {
      res.status(400).json({ success: false, error: '请指定面值和数量（1-100）。' });
      return;
    }

    const batchId = `BATCH-${Date.now()}`;
    const codes = [];

    for (let i = 0; i < count; i++) {
      const code = generateCodeString();
      codes.push({
        code,
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
    res.status(500).json({ success: false, error: '生成激活码失败。' });
  }
});

// POST /api/ops/codes/void
router.post('/codes/void', async (req: AuthRequest, res: Response) => {
  try {
    const { codeIds } = req.body;
    if (!codeIds || !Array.isArray(codeIds)) {
      res.status(400).json({ success: false, error: '请指定要作废的激活码 ID。' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('recharge_codes')
      .update({ status: 'voided' })
      .in('id', codeIds)
      .eq('status', 'unused');

    if (error) throw error;
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: '操作失败。' });
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

// GET /api/ops/tasks — 任务监控视图
router.get('/tasks', async (_req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select(`
        id, user_id, title, stage, status, target_words,
        failure_stage, failure_reason, refunded,
        frozen_credits, created_at, updated_at, completed_at,
        user_profiles(email)
      `)
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    // 附加最近降 AI 失败信息
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
    await setConfig(req.params.key, value, req.userEmail!);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: '更新配置失败。' });
  }
});

function generateCodeString(): string {
  // 生成 16 位大写字母数字激活码
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 16; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
    if (i === 3 || i === 7 || i === 11) code += '-';
  }
  return code;
}

export default router;
```

**Step 2: 更新 index.ts 挂载运营路由**

```typescript
import { opsMiddleware } from './middleware/ops';
import opsRoutes from './routes/ops';
// ...
app.use('/api/ops', authMiddleware, opsMiddleware, opsRoutes);
```

**Step 3: 验证 + Commit**

Run: `cd server && npm run lint`

```bash
git add server/src/routes/ops.ts server/src/index.ts
git commit -m "feat: add ops endpoints - user management, activation codes, task monitoring, config"
```

---

### Task 12: Cleanup 定时清理服务

**Files:**
- Create: `server/src/cleanup.ts`

**Step 1: 创建 cleanup.ts**

```typescript
// server/src/cleanup.ts
import cron from 'node-cron';
import { supabaseAdmin } from './lib/supabase';
import { refundCredits } from './services/walletService';
import { failTask } from './services/taskService';
import { deleteExpiredFiles } from './services/fileService';
import { getConfig } from './services/configService';
import './config/env'; // 加载环境变量

async function cleanupStuckTasks() {
  const timeoutMinutes = (await getConfig('stuck_task_timeout_minutes')) || 30;
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  const { data: stuckTasks } = await supabaseAdmin
    .from('tasks')
    .select('id, user_id, stage, frozen_credits')
    .eq('status', 'processing')
    .lt('updated_at', cutoff);

  if (!stuckTasks || stuckTasks.length === 0) {
    console.log('[cleanup] No stuck tasks found.');
    return;
  }

  for (const task of stuckTasks) {
    console.log(`[cleanup] Processing stuck task ${task.id} at stage ${task.stage}`);

    // 收费阶段的卡住任务需要退款
    const paidStages = ['writing', 'word_calibrating', 'citation_checking', 'delivering'];
    const needsRefund = paidStages.includes(task.stage) && task.frozen_credits > 0;

    if (needsRefund) {
      try {
        await refundCredits(task.user_id, task.frozen_credits, 'task', task.id, `卡住任务自动退款：${task.frozen_credits} 积分`);
        await failTask(task.id, task.stage, '任务处理超时，积分已自动退回。请重新创建任务。', true);
      } catch (err) {
        console.error(`[cleanup] Refund failed for task ${task.id}:`, err);
        await failTask(task.id, task.stage, '任务超时，退款异常，请联系客服。', false);
      }
    } else {
      await failTask(task.id, task.stage, '任务处理超时，请重新创建任务。', false);
    }

    // 检查 humanizing 阶段的卡住
    if (task.stage === 'humanizing') {
      const { data: pendingJobs } = await supabaseAdmin
        .from('humanize_jobs')
        .select('id, frozen_credits')
        .eq('task_id', task.id)
        .eq('status', 'processing');

      for (const job of pendingJobs || []) {
        try {
          await refundCredits(task.user_id, job.frozen_credits, 'humanize_job', job.id, `降 AI 超时退款：${job.frozen_credits} 积分`);
          await supabaseAdmin.from('humanize_jobs').update({
            status: 'failed',
            failure_reason: '处理超时，积分已退回。',
            refunded: true,
          }).eq('id', job.id);
        } catch (err) {
          console.error(`[cleanup] Humanize refund failed for job ${job.id}:`, err);
        }
      }

      // humanizing 超时，任务回到 completed
      await supabaseAdmin.from('tasks').update({
        stage: 'completed',
        updated_at: new Date().toISOString(),
      }).eq('id', task.id);
    }
  }
}

async function cleanupExpiredFiles() {
  const count = await deleteExpiredFiles();
  console.log(`[cleanup] Deleted ${count} expired files.`);
}

async function cleanupExpiredMaterials() {
  const retentionDays = (await getConfig('material_retention_days')) || 3;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const { data: oldMaterials } = await supabaseAdmin
    .from('task_files')
    .select('id, storage_path')
    .eq('category', 'material')
    .lt('created_at', cutoff.toISOString());

  if (!oldMaterials || oldMaterials.length === 0) {
    console.log('[cleanup] No expired materials found.');
    return;
  }

  for (const file of oldMaterials) {
    await supabaseAdmin.storage.from('task-files').remove([file.storage_path]);
    await supabaseAdmin.from('task_files').delete().eq('id', file.id);
  }

  console.log(`[cleanup] Cleaned up ${oldMaterials.length} expired material files.`);
}

// 每天凌晨 3 点执行
cron.schedule('0 3 * * *', async () => {
  console.log('[cleanup] Starting daily cleanup...');
  try {
    await cleanupStuckTasks();
    await cleanupExpiredFiles();
    await cleanupExpiredMaterials();
    console.log('[cleanup] Daily cleanup completed.');
  } catch (err) {
    console.error('[cleanup] Cleanup failed:', err);
  }
});

console.log('[cleanup] Cleanup service started. Scheduled for 3:00 AM daily.');

// 启动时也执行一次
(async () => {
  console.log('[cleanup] Running initial cleanup...');
  await cleanupStuckTasks();
  await cleanupExpiredFiles();
  await cleanupExpiredMaterials();
  console.log('[cleanup] Initial cleanup completed.');
})();
```

**Step 2: 验证 + Commit**

Run: `cd server && npm run lint`

```bash
git add server/src/cleanup.ts
git commit -m "feat: add daily cleanup service - stuck tasks, expired files, material cleanup"
```

---

## 阶段 5：前端接通

### Task 13: 前端安装 Supabase + 创建 Auth 上下文

**Files:**
- Modify: `拼代代前端文件/package.json` — 添加 @supabase/supabase-js
- Create: `拼代代前端文件/src/lib/supabase.ts`
- Create: `拼代代前端文件/src/contexts/AuthContext.tsx`
- Modify: `拼代代前端文件/src/main.tsx` — 包裹 AuthProvider
- Modify: `拼代代前端文件/src/App.tsx` — 添加路由守卫

这个 Task 改动较大，具体代码在执行时根据现有前端代码生成。核心要点：

1. `supabase.ts` 初始化客户端（用 SUPABASE_URL + ANON_KEY）
2. `AuthContext` 提供 `user`, `loading`, `signIn`, `signOut`, `signUp`
3. `signUp` 成功后调用 `POST /api/user/init`
4. 路由守卫：未登录访问 dashboard 跳转到 /login
5. 已登录访问 /login, /register 跳转到 /dashboard/workspace

**Commit:**
```bash
git commit -m "feat: add Supabase auth integration and route guards to frontend"
```

---

### Task 14: 前端改造 — 登录、注册页接通真实 Auth

**Files:**
- Modify: `拼代代前端文件/src/pages/Login.tsx`
- Modify: `拼代代前端文件/src/pages/Register.tsx`

核心要点：
1. Login 页面调用 `supabase.auth.signInWithPassword`
2. Register 页面调用 `supabase.auth.signUp` + `POST /api/user/init`
3. 初始化失败时拦住用户，提示重试
4. Login 页面添加"忘记密码请联系客服"提示

**Commit:**
```bash
git commit -m "feat: connect Login and Register pages to Supabase Auth"
```

---

### Task 15: 前端改造 — DashboardLayout、Recharge、Tasks 接通后端

**Files:**
- Modify: `拼代代前端文件/src/components/layout/DashboardLayout.tsx` — 真实用户信息
- Modify: `拼代代前端文件/src/pages/dashboard/Recharge.tsx` — 接通真实余额和兑换
- Modify: `拼代代前端文件/src/pages/dashboard/Tasks.tsx` — 接通真实任务列表

**Commit:**
```bash
git commit -m "feat: connect dashboard layout, recharge, and tasks pages to backend API"
```

---

### Task 16: 前端改造 — Workspace 接通后端

**Files:**
- Modify: `拼代代前端文件/src/pages/dashboard/Workspace.tsx`
- Create: `拼代代前端文件/src/lib/api.ts` — API 调用封装

这是最大的改造任务。核心要点：

1. `api.ts` 封装所有 API 调用，自动带 Bearer token
2. 步骤 1：真实文件上传 + 创建任务
3. 步骤 2：展示真实大纲，修改/确认功能接通
4. 步骤 3-5：轮询 `GET /api/task/current` 获取真实阶段
5. 步骤 6：真实下载链接
6. 步骤 7：真实降 AI
7. 支持 `?taskId=xxx` 参数打开历史任务只读模式

**Commit:**
```bash
git commit -m "feat: connect Workspace to backend - real file upload, outline, writing pipeline, humanize"
```

---

### Task 17: 更新环境变量和最终验证

**Files:**
- Modify: `拼代代前端文件/.env.example`
- Create: `拼代代前端文件/.env`

**Step 1: 前端 .env**

```env
VITE_SUPABASE_URL=https://rjnfctvauewstngqbvrz.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_API_BASE_URL=http://localhost:3001
```

**Step 2: 全面验证**

```bash
# 后端
cd server && npm run lint && npm run build

# 前端
cd 拼代代前端文件 && npm run lint && npm run build
```

**Step 3: 更新 PLAN.md**

将已完成的任务打勾，更新进度。

**Commit:**
```bash
git commit -m "chore: add env config, verify build passes, update PLAN.md"
```

---

## 执行顺序总结

| 阶段 | Task | 说明 | 依赖 |
|------|------|------|------|
| 0 | 1 | 项目脚手架 | 无 |
| 0 | 2 | 基础代码结构 | Task 1 |
| 0 | 3 | 数据库建表 | 无（可与 1-2 并行） |
| 1 | 4 | 中间件 | Task 2 |
| 1 | 5 | 用户路由 | Task 4 |
| 1 | 6 | 激活码 + 余额 | Task 5 |
| 2 | 7 | 文件上传 + 任务 | Task 6 |
| 2 | 8 | 大纲生成 | Task 7 |
| 3 | 9 | 正文流水线 | Task 8 |
| 4 | 10 | 降 AI | Task 9 |
| 4 | 11 | 运营端 API | Task 6 |
| 4 | 12 | Cleanup | Task 9 |
| 5 | 13 | 前端 Auth | Task 5 |
| 5 | 14 | 登录注册改造 | Task 13 |
| 5 | 15 | Dashboard 改造 | Task 14 |
| 5 | 16 | Workspace 改造 | Task 15 |
| 5 | 17 | 最终验证 | Task 16 |
