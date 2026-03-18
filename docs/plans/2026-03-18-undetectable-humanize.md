# Undetectable 降 AI接入 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把降 AI 从 OpenAI 切到 Undetectable，同时修掉环境模块测试依赖真实环境的问题，并把文档和线上环境同步好。

**Architecture:** 主写作链路继续走 OpenAI，不动。降 AI 单独改成通过后端调用 Undetectable 的 `/submit` 和 `/document`。环境变量解析拆成“纯解析”和“运行时加载”两层，保证测试干净、启动严格。

**Tech Stack:** TypeScript, Node.js, Express, Supabase, Undetectable Humanization API, node:test

---

### Task 1: 环境变量模块拆分

**Files:**
- Create: `server/src/lib/runtimeEnv.ts`
- Modify: `server/src/config/env.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/cleanup.ts`
- Test: `server/src/config/env.test.ts`

**Step 1: Write the failing test**

补一条环境变量测试，确认 `parseEnv()` 缺 `UNDETECTABLE_API_KEY` 会报错。

**Step 2: Run test to verify it fails**

Run: `cd /Users/jeffo/Desktop/拼代代/server && npm test -- src/config/env.test.ts`
Expected: FAIL，因为当前还没校验 `UNDETECTABLE_API_KEY`

**Step 3: Write minimal implementation**

- `env.ts` 保留纯函数和类型，不在模块顶层直接导出 `env = parseEnv(process.env)`
- 新增 `runtimeEnv.ts`，负责 `dotenv.config()` 后导出 `env`
- `index.ts` 和 `cleanup.ts` 改成从 `runtimeEnv.ts` 进入
- `parseEnv()` 新增 `UNDETECTABLE_API_KEY` 必填校验

**Step 4: Run test to verify it passes**

Run: `cd /Users/jeffo/Desktop/拼代代/server && npm test -- src/config/env.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/config/env.ts server/src/config/env.test.ts server/src/lib/runtimeEnv.ts server/src/index.ts server/src/cleanup.ts
git commit -m "refactor: isolate runtime env loading"
```

### Task 2: 写 Undetectable 客户端测试

**Files:**
- Create: `server/src/lib/undetectable.ts`
- Test: `server/src/lib/undetectable.test.ts`

**Step 1: Write the failing test**

先写测试覆盖：
- 提交请求会带 `apikey`
- 会提交固定参数 `v11sr / More Human / University / Essay`
- 轮询会等待直到拿到 `output`
- 超时会报错

**Step 2: Run test to verify it fails**

Run: `cd /Users/jeffo/Desktop/拼代代/server && npm test -- src/lib/undetectable.test.ts`
Expected: FAIL，因为文件还不存在

**Step 3: Write minimal implementation**

实现一个小客户端：
- `submitHumanization(text)`
- `waitForHumanizedOutput(documentId)`
- 内部通过可注入的 `fetch` 和 `sleep` 方便测试

**Step 4: Run test to verify it passes**

Run: `cd /Users/jeffo/Desktop/拼代代/server && npm test -- src/lib/undetectable.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/lib/undetectable.ts server/src/lib/undetectable.test.ts
git commit -m "feat: add Undetectable humanize client"
```

### Task 3: 接到 humanizeService

**Files:**
- Modify: `server/src/services/humanizeService.ts`
- Test: `server/src/services/humanizeService.test.ts`

**Step 1: Write the failing test**

补一条降 AI 主流程测试，确认：
- 成功时使用 Undetectable 输出生成 `humanized_doc`
- 失败时会退款并写失败原因

**Step 2: Run test to verify it fails**

Run: `cd /Users/jeffo/Desktop/拼代代/server && npm test -- src/services/humanizeService.test.ts`
Expected: FAIL，因为当前服务还在用 OpenAI，且测试文件不存在

**Step 3: Write minimal implementation**

- 从 `humanizeService.ts` 里去掉 OpenAI 调用
- 改成：
  - `submitHumanization(inputText)`
  - `waitForHumanizedOutput(id)`
- 成功后沿用现有：
  - 存 `document_versions`
  - 生成 `humanized_doc`
  - `settleCredits`
  - 更新 `humanize_jobs`
  - 更新 `tasks`
  - 写 `task_events`
- 失败后沿用现有退款和失败处理

**Step 4: Run test to verify it passes**

Run: `cd /Users/jeffo/Desktop/拼代代/server && npm test -- src/services/humanizeService.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/services/humanizeService.ts server/src/services/humanizeService.test.ts
git commit -m "feat: switch humanize to Undetectable"
```

### Task 4: 更新文档和示例配置

**Files:**
- Modify: `server/.env.example`
- Modify: `agent.md`
- Modify: `DESIGN.md`
- Modify: `docs/private/deployment-secrets.local.md`
- Modify: `docs/plans/2026-03-16-backend-implementation.md`

**Step 1: Write the failing test**

这里不写自动测试，改成人工核对清单。

**Step 2: Run test to verify it fails**

不适用。

**Step 3: Write minimal implementation**

- 补 `UNDETECTABLE_API_KEY`
- 把文档里“降 AI 暂时走 OpenAI”的描述改成“现在走 Undetectable”
- 把固定参数写清楚

**Step 4: Run test to verify it passes**

人工检查：
- 不再出现“降 AI 仍走 OpenAI”的错误描述
- 文档里写清楚 `v11sr / More Human / University / Essay`

**Step 5: Commit**

```bash
git add server/.env.example agent.md DESIGN.md docs/private/deployment-secrets.local.md docs/plans/2026-03-16-backend-implementation.md
git commit -m "docs: document Undetectable humanize integration"
```

### Task 5: 全量验证并上线

**Files:**
- Modify: Railway `app` env
- Modify: Railway `cleanup` env

**Step 1: Write the failing test**

不新增自动测试；这里做本地和线上验证。

**Step 2: Run test to verify it fails**

如果本地缺 `UNDETECTABLE_API_KEY`，服务启动应失败。

**Step 3: Write minimal implementation**

- 本地 `.env` 补 `UNDETECTABLE_API_KEY`
- Railway `app` / `cleanup` 补 `UNDETECTABLE_API_KEY`
- push 到 `main`

**Step 4: Run test to verify it passes**

Run:
- `cd /Users/jeffo/Desktop/拼代代/server && npm test`
- `cd /Users/jeffo/Desktop/拼代代/server && npm run lint`
- `cd /Users/jeffo/Desktop/拼代代/server && npm run build`

线上检查：
- GitHub Actions 成功
- Railway 最新部署成功
- `/health` 正常
- 真实发起一次降 AI，最终出现 `humanized_doc`

**Step 5: Commit**

```bash
git add .
git commit -m "feat: integrate Undetectable humanize pipeline"
git push origin main
```
