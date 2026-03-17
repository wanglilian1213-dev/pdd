# Code Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修掉这次 code review 找出的 6 个真实高风险问题，重点收口数据库门禁、扣费一致性、任务失败清理和交付文件可靠性。

**Architecture:** 先把数据库这一层补牢：为公开表开启 RLS（按用户隔离的访问门禁），并把“检查条件 + 扣费/加钱 + 改状态 + 记流水”这类必须一起成功的操作收进数据库函数里，避免前后端并发时出现重复扣费或状态错乱。然后再回到 Node 服务层，改掉上传中途失败、交付文件上传失败不报错、降 AI 假处理中卡死等问题，最后用测试和真实接口验证。

**Tech Stack:** Supabase Postgres / RLS / SQL functions, Express, TypeScript, React, Railway

---

### Task 1: 记录根因和修复顺序

**Files:**
- Create: `docs/plans/2026-03-17-code-review-fixes.md`

**Step 1: 写清楚 6 个问题**

- 数据库公开读表
- 钱包更新非原子，存在并发覆盖
- 任务创建中途失败后遗留 processing 任务
- 降 AI 先建 processing 记录再扣费，失败会卡死
- 交付文件上传失败可能仍然收钱并标完成
- 激活码先作废再加余额，失败会白烧

**Step 2: 确认修复顺序**

1. 数据库门禁
2. 钱包/充值/确认大纲/降 AI 的原子操作
3. 任务创建和交付上传的失败清理
4. 测试与验证

### Task 2: 先写失败测试

**Files:**
- Modify: `server/src/services/materialInputService.test.ts`
- Create: `server/src/services/fileService.test.ts`
- Create: `server/src/services/rechargeService.test.ts`
- Create: `server/src/services/walletService.test.ts`
- Create: `server/src/services/humanizeService.test.ts`
- Create: `server/src/services/writingService.test.ts`

**Step 1: 为上传清理写失败测试**

- `uploadFiles` 中途失败时要清掉已上传文件
- 创建任务时若文件上传失败，不能残留 processing 任务

**Step 2: 为钱包/充值写失败测试**

- 充值改成调用原子函数
- 钱包冻结/退款/结算改成调用原子函数
- 数据库函数返回失败时要映射成清楚的人话报错

**Step 3: 为降 AI 和交付写失败测试**

- `startHumanize` 扣费失败时不能残留 processing job
- 交付文件上传失败时必须抛错，不能继续结算

### Task 3: 新增 Supabase 迁移

**Files:**
- Create: `server/supabase/migrations/20260317000000_security_and_atomic_ops.sql`

**Step 1: 开启 RLS**

- 对所有业务表开启 RLS
- 只有用户自己的资料、钱包、任务、流水、版本、事件允许读取
- `recharge_codes`、`system_config` 等运营/后台表不给公开身份直接读

**Step 2: 新增数据库函数**

- 钱包加余额
- 钱包冻结
- 钱包结算
- 钱包退款
- 激活码兑换
- 确认大纲并冻结积分
- 启动降 AI 并冻结积分/创建 job

**Step 3: 约束并发**

- 用行锁或等价方式，确保同一时刻只会有一个请求改同一钱包/同一任务
- 给 `humanize_jobs` 的 processing 状态补唯一约束

### Task 4: 改后端服务

**Files:**
- Modify: `server/src/services/walletService.ts`
- Modify: `server/src/services/rechargeService.ts`
- Modify: `server/src/services/outlineService.ts`
- Modify: `server/src/services/humanizeService.ts`
- Modify: `server/src/services/fileService.ts`
- Modify: `server/src/routes/task.ts`
- Modify: `server/src/services/writingService.ts`
- Modify: `server/src/services/taskService.ts`

**Step 1: 钱包和充值改走数据库函数**

- 服务层不再自己“先读余额再写回”
- 统一调用数据库函数，保证一次做完

**Step 2: 确认大纲改成原子操作**

- 在同一套数据库动作里完成：
  - 检查任务阶段
  - 扣除余额并冻结
  - 更新任务到 `writing`
  - 写事件

**Step 3: 降 AI 改成原子启动**

- 不能先写 processing job 再扣费
- 必须“扣费成功 + job 创建成功 + task 改 stage”一起完成

**Step 4: 上传和交付失败清理**

- `uploadFiles` 中途失败要清理存储和数据库残留
- `task/create` 若上传失败，要删除新建任务
- 交付文件上传失败必须立刻中断流程，不允许继续结算
- 如果上传成功但写数据库记录失败，要把刚上传的文件删掉

### Task 5: 验证

**Files:**
- Validate only

**Step 1: 跑后端测试**

Run: `cd server && npm test`

**Step 2: 跑类型检查和构建**

Run: `cd server && npm run lint && npm run build`

**Step 3: 跑前端检查和构建**

Run: `cd 拼代代前端文件 && npm run lint && npm run build`

**Step 4: 做安全回归**

- 用公开身份直接访问 `user_profiles`
- 用公开身份直接访问 `system_config`
- 用公开身份直接访问 `recharge_codes`
- 预期都应被拒绝

