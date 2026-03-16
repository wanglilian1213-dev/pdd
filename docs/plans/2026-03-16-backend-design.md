# 拼代代后端设计文档

> 日期：2026-03-16
> 状态：已确认，待实施

## 1. 架构概述

采用 Monorepo 单仓库方案，后端代码放在 `server/` 目录下，与前端 `拼代代最终版/` 并列。

```
拼代代/
├── 拼代代最终版/          ← 现有前端（不动）
└── server/                ← 后端
```

### 平台分工

- **Supabase**：Auth + Database + Storage
- **Railway app**：业务逻辑 + AI 调用（Express）
- **Railway cleanup**：定时清理（每天跑一次）

### 连接规则

- 前端登录 → Supabase Auth
- 前端业务 → Railway app
- 不允许第三种连接

## 2. 数据库表结构

### 2.1 user_profiles

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid, PK | = auth.users.id |
| email | text | 冗余存一份，方便运营查询 |
| nickname | text | 昵称（可选） |
| status | text | `active` / `disabled` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 2.2 wallets

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid, PK | |
| user_id | uuid, FK → user_profiles, unique | |
| balance | integer | 可用余额 |
| frozen | integer | 冻结中积分 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 2.3 credit_ledger

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid, PK | |
| user_id | uuid, FK | |
| type | text | `recharge` / `consume` / `refund` |
| amount | integer | 正数=入账，负数=扣除 |
| balance_after | integer | 操作后余额快照 |
| ref_type | text | 关联对象类型 |
| ref_id | uuid | 关联对象 ID |
| note | text | 备注 |
| created_at | timestamptz | |

### 2.4 recharge_codes

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid, PK | |
| code | text, unique | 激活码字符串 |
| denomination | integer | 面值 |
| status | text | `unused` / `used` / `voided` |
| used_by | uuid, FK, nullable | |
| used_at | timestamptz, nullable | |
| created_by | text | 创建人邮箱 |
| batch_id | text | 批次号 |
| created_at | timestamptz | |

### 2.5 tasks

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid, PK | |
| user_id | uuid, FK | |
| title | text | |
| stage | text | 当前阶段 |
| status | text | `processing` / `completed` / `failed` |
| target_words | integer | 目标字数 |
| citation_style | text | 引用格式 |
| special_requirements | text | 特殊要求 |
| outline_edits_used | integer | 已用修改次数（上限4） |
| frozen_credits | integer | 当前冻结积分 |
| failure_stage | text, nullable | |
| failure_reason | text, nullable | |
| refunded | boolean | |
| started_at | timestamptz | |
| completed_at | timestamptz, nullable | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

任务 stage 状态机：

```
uploading → outline_generating → outline_ready → writing → word_calibrating → citation_checking → delivering → completed
任何收费阶段失败 → failed（自动退款）
任何免费阶段失败 → failed（不退款）
completed → humanizing → completed（降 AI 失败也回到 completed）
```

### 2.6 task_files

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid, PK | |
| task_id | uuid, FK | |
| category | text | `material` / `final_doc` / `citation_report` / `humanized_doc` |
| original_name | text | |
| storage_path | text | |
| file_size | integer | |
| mime_type | text | |
| expires_at | timestamptz, nullable | |
| created_at | timestamptz | |

### 2.7 outline_versions

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid, PK | |
| task_id | uuid, FK | |
| version | integer | |
| content | text | 大纲正文 |
| edit_instruction | text, nullable | |
| target_words | integer | |
| citation_style | text | |
| created_at | timestamptz | |

### 2.8 document_versions

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid, PK | |
| task_id | uuid, FK | |
| version | integer | |
| stage | text | `draft` / `calibrated` / `verified` / `final` |
| word_count | integer | |
| content | text | |
| created_at | timestamptz | |

### 2.9 humanize_jobs

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid, PK | |
| task_id | uuid, FK | |
| input_version_id | uuid, FK → document_versions | |
| input_word_count | integer | 收费依据 |
| frozen_credits | integer | |
| status | text | `processing` / `completed` / `failed` |
| failure_reason | text, nullable | |
| refunded | boolean | |
| created_at | timestamptz | |
| completed_at | timestamptz, nullable | |

### 2.10 task_events

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid, PK | |
| task_id | uuid, FK | |
| event_type | text | |
| detail | jsonb | |
| created_at | timestamptz | |

### 2.11 system_config

| 字段 | 类型 | 说明 |
|------|------|------|
| key | text, PK | |
| value | jsonb | |
| updated_at | timestamptz | |
| updated_by | text | |

默认配置：
- writing_price_per_1000: 250
- humanize_price_per_1000: 250
- result_file_retention_days: 3
- material_retention_days: 3
- stuck_task_timeout_minutes: 30
- max_outline_edits: 4
- activation_denominations: [1000, 3000, 10000, 20000]

### 数据库硬约束

```sql
CREATE UNIQUE INDEX idx_one_active_task_per_user
ON tasks (user_id)
WHERE status = 'processing';
```

## 3. API 路由

### 3.1 用户端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/user/init | 注册后初始化 |
| GET | /api/user/profile | 用户信息 + 余额 |
| POST | /api/recharge/redeem | 兑换激活码 |
| GET | /api/recharge/history | 积分流水 |
| POST | /api/task/create | 创建任务 + 上传文件 |
| GET | /api/task/current | 当前进行中任务 |
| GET | /api/task/:id | 指定任务详情 |
| GET | /api/task/list | 任务列表 |
| POST | /api/task/:id/outline/regenerate | 修改大纲 |
| POST | /api/task/:id/outline/confirm | 确认大纲 → 冻结 → 启动正文 |
| POST | /api/task/:id/humanize | 发起降 AI |
| GET | /api/task/:id/file/:fileId/download | 下载文件 |

### 3.2 运营端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/ops/users | 用户列表 |
| POST | /api/ops/users/:id/disable | 禁用账号 |
| POST | /api/ops/users/:id/enable | 恢复账号 |
| POST | /api/ops/codes/generate | 批量生成激活码 |
| POST | /api/ops/codes/void | 作废激活码 |
| GET | /api/ops/codes | 激活码列表 |
| GET | /api/ops/tasks | 任务监控 |
| GET | /api/ops/config | 读取配置 |
| PUT | /api/ops/config/:key | 更新配置 |

### 3.3 中间件

| 中间件 | 作用 |
|--------|------|
| authMiddleware | 验证 Supabase JWT |
| opsMiddleware | 运营白名单校验 |
| rateLimiter | 限频 |
| statusGuard | 账号状态检查 |

## 4. 核心业务流程

### 4.1 正文主流程

1. 用户确认大纲
2. 计算费用：ceil(target_words / 1000) × 250
3. 检查余额 ≥ 费用
4. 冻结积分（事务）
5. task.stage = 'writing'，返回前端
6. 异步执行：正文生成 → 字数矫正 → 引用核验 → 交付整理
7. 每步成功更新 stage，前端轮询获取
8. 全部成功：结算冻结积分，生成文件
9. 任一步失败：退回冻结积分，记录失败原因

### 4.2 失败退款流程

在一个事务里完成：
1. task.failure_stage = 当前阶段
2. task.failure_reason = 人话描述
3. task.status = 'failed'
4. frozen -= amount, balance += amount
5. 写退款流水
6. task.refunded = true

### 4.3 降 AI 流程

1. 检查前置条件
2. 确定输入版本（第1次用原始正文，第N次用上一次成功版本）
3. 计算费用：ceil(input_word_count / 1000) × 250
4. 冻结积分，创建 humanize_job
5. 异步执行降 AI
6. 成功：结算，保存新版本，task.stage 回到 completed
7. 失败：退款，task.stage 仍回到 completed（不破坏主任务）

### 4.4 激活码兑换

一个事务：校验激活码 → 加余额 → 写流水 → 标记已使用

### 4.5 Cleanup（每天跑一次）

1. 扫描卡住任务（超过30分钟）→ 标记失败 + 退款
2. 清理过期结果文件
3. 清理过期材料文件

## 5. 技术栈

| 用途 | 选型 |
|------|------|
| 框架 | Express + TypeScript |
| 数据库 | @supabase/supabase-js |
| AI | openai（Responses API） |
| 文件上传 | multer |
| 生成 .docx | docx |
| 限频 | express-rate-limit |
| 定时任务 | node-cron |

## 6. 项目结构

```
server/
├── src/
│   ├── index.ts
│   ├── cleanup.ts
│   ├── config/env.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── ops.ts
│   │   ├── rateLimiter.ts
│   │   └── statusGuard.ts
│   ├── routes/
│   │   ├── user.ts
│   │   ├── recharge.ts
│   │   ├── task.ts
│   │   └── ops.ts
│   ├── services/
│   │   ├── userService.ts
│   │   ├── walletService.ts
│   │   ├── rechargeService.ts
│   │   ├── taskService.ts
│   │   ├── outlineService.ts
│   │   ├── writingService.ts
│   │   ├── humanizeService.ts
│   │   ├── fileService.ts
│   │   └── configService.ts
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── openai.ts
│   │   └── errors.ts
│   └── types/index.ts
├── db/migrations/001_init.sql
├── package.json
├── tsconfig.json
└── .env.example
```

## 7. Railway 部署

| Service | Root Directory | Start Command |
|---------|---------------|---------------|
| app | /server | npm run start |
| cleanup | /server | npm run start:cleanup |

## 8. 环境变量

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
OPS_WHITELIST_EMAILS=
PORT=3001
NODE_ENV=production
```

## 9. 关键设计决策

1. AI 用 OpenAI Responses API，不是 Google GenAI
2. 正文单价 250积分/千字，降AI 250积分/千字（可通过 system_config 调整）
3. Cleanup 每天跑一次
4. 前端不直接调 AI，所有 AI 调用走 Railway app
5. 所有收费操作用数据库事务保证原子性
