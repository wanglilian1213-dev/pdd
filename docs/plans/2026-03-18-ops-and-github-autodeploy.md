# 运营接口收口与 GitHub 自动发布实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把现有运营专用接口补成真能用、真能管、真能测的一套入口，并把 GitHub 推送到 `main` 后自动发布到 Railway 的流程接上，减少后续手工部署。

**Architecture:** 不新增运营页面，继续沿用“Supabase 后台看数据 + Railway 运营接口做写操作”的第一阶段方案。后端先补输入检查、错误提示、白名单配置和关键联调，再补自动化测试。自动发布采用 GitHub Actions 调 Railway CLI 的方式：仓库里固化工作流，GitHub 保存 Railway 令牌，推送 `main` 后分别部署后端 `app` 和前端 `拼代代前端` 两个服务。

**Tech Stack:** Express, TypeScript, Supabase Auth/Database, Railway CLI, GitHub Actions

---

### Task 1: 先把运营接口边界和缺口写清楚

**Files:**
- Create: `docs/plans/2026-03-18-ops-and-github-autodeploy.md`
- Check: `server/src/routes/ops.ts`
- Check: `server/src/middleware/ops.ts`
- Check: `server/src/middleware/statusGuard.ts`

**Step 1: 记录现状**

- 运营接口已存在，但缺少系统化输入检查和回归测试
- 线上运营白名单仍是占位邮箱，需要换成真实邮箱
- GitHub 仓库里还没有自动发布工作流

**Step 2: 确认收口范围**

- 用户列表、禁用/恢复账号
- 批量生成激活码、作废激活码、查询激活码
- 查询任务监控、读取/更新系统配置
- GitHub 推送 `main` 后自动部署前后端

### Task 2: 先写失败测试

**Files:**
- Create: `server/src/routes/ops.test.ts`
- Create: `server/src/middleware/statusGuard.test.ts`

**Step 1: 运营接口测试**

- 白名单外邮箱访问 `/api/ops/*` 必须返回 403
- 激活码生成数量超范围、面值不在允许范围时必须返回 400
- 作废激活码时未传数组必须返回 400
- 更新配置时值不合法必须返回 400

**Step 2: 账号禁用拦截测试**

- 已禁用用户访问业务接口时必须被拦住
- 未初始化用户仍然得到明确提示

### Task 3: 改后端运营接口

**Files:**
- Modify: `server/src/routes/ops.ts`
- Modify: `server/src/middleware/ops.ts`
- Modify: `server/src/services/configService.ts`
- Modify: `server/src/index.ts`

**Step 1: 把输入检查补完整**

- 激活码生成只允许预设面值
- 数量限制固定 1 到 100
- 配置项只允许更新已存在键
- 数值类配置必须是正数
- 天数、次数这类整数配置必须是正整数

**Step 2: 把错误提示改成人话**

- 返回“账号不存在”“激活码已使用或已作废”“配置不存在”“配置值格式不对”这类明确错误

**Step 3: 把线上运营白名单改成真实邮箱**

- Railway `app` 服务的 `OPS_WHITELIST_EMAILS` 改成用户提供的邮箱

### Task 4: 配 GitHub 自动发布

**Files:**
- Create: `.github/workflows/deploy-app.yml`
- Create: `.github/workflows/deploy-frontend.yml`
- Modify: `agent.md`
- Modify: `PLAN.md`

**Step 1: 写 GitHub Actions**

- 推送到 `main` 后自动部署后端 `app`
- 推送到 `main` 后自动部署前端 `拼代代前端`
- 工作流里显式写 Railway 项目、环境、服务，避免依赖本地 link

**Step 2: 配 GitHub Secrets**

- 写入 Railway 令牌
- 不把令牌落进仓库

**Step 3: 文档补齐**

- 写清楚自动发布怎么触发
- 写清楚运营白名单改哪里

### Task 5: 真联调和发布验证

**Files:**
- Validate only

**Step 1: 跑后端测试和检查**

Run:

```bash
cd /Users/jeffo/Desktop/拼代代/server
npm test
npm run lint
npm run build
```

**Step 2: 做运营接口真联调**

- 用白名单账号调用 `/api/ops/users`
- 生成一批激活码
- 查询刚生成的激活码
- 作废一部分未使用激活码
- 读取和修改一个安全配置项

**Step 3: 验证 GitHub 自动发布**

- 提交并推送一次代码到 `main`
- 确认 GitHub Actions 运行成功
- 确认 Railway 两个服务都收到新部署
