# 拼代代当前收口与下一步实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 先把“文档说的进度”和“代码真实做到的进度”对齐，再修掉当前会拦住开发的硬问题，最后把材料处理改成“原文件直接交给 AI”，不再在本地硬拆内容。

**Architecture:** 先做收口，不急着继续堆新功能。第一步先修“现在就会绊倒人”的问题，比如前端类型检查失败、文档路径和技术栈写错、进度表明显过期；第二步再做真实联调，把注册、充值、任务、收费、退款这条主链路跑通；第三步把材料处理改成“文件原样交给 OpenAI”，不在本地维护一堆解析器。

**Tech Stack:** React 19, TypeScript, Vite, Supabase Auth/Database/Storage, Express, OpenAI Responses API, Railway

---

### Task 1: 先把项目现状写对，别让文档继续带偏

**Files:**
- Modify: `agent.md`
- Modify: `PLAN.md`
- Modify: `DESIGN.md`

**Step 1: 更新 `agent.md` 里的真实目录和技术栈**

- 把前端目录统一写成 `拼代代前端文件/`
- 把 AI 调用统一写成 `OpenAI Responses API`
- 检查 PRD 文件名是否和当前仓库一致，避免再出现“文档里写一个，硬盘上是另一个”

**Step 2: 重写 `PLAN.md` 的完成情况**

- 把已经实际接上的内容改成已完成：
  - Supabase 登录态保持
  - 注册后初始化
  - 未登录访问 dashboard 自动跳转
  - 激活码兑换
  - 余额和积分流水读取
  - 任务创建、任务列表、任务详情、下载接口
  - 大纲生成/修改/确认
  - 正文链路和降 AI 后端接口
- 把还没做好的部分放进“正在做”和“已知问题”

**Step 3: 把当前真实问题写进 `PLAN.md`**

- 前端 `npm run lint` 失败
- 材料处理当时还是“把文件硬读成文本”，二进制文件不靠谱
- 登录限频写了中间层但没有真正接到登录入口
- 文档和代码不一致，容易误导后续开发

**Step 4: 验证文档修改没有写错**

Run:

```bash
cd /Users/jeffo/Desktop/拼代代
sed -n '1,220p' agent.md
sed -n '1,220p' PLAN.md
sed -n '1,220p' DESIGN.md
```

Expected:
- 三份文档对前端目录、AI 方案、当前进度的描述一致

**Step 5: Commit**

```bash
git add agent.md PLAN.md DESIGN.md
git commit -m "docs: sync project status with actual implementation"
```

---

### Task 2: 先修当前最硬的阻塞，恢复“能放心继续改”的状态

**Files:**
- Modify: `拼代代前端文件/src/pages/dashboard/Workspace.tsx`

**Step 1: 修掉前端类型检查报错**

- 处理拖拽上传那里 `file.name` 被 TypeScript 认成未知值的问题
- 修完后确认 `npm run lint` 不再报错

**Step 2: 重新跑前端检查**

Run:

```bash
cd /Users/jeffo/Desktop/拼代代/拼代代前端文件
npm run lint
npm run build
```

Expected:
- `lint` 通过
- `build` 成功

**Step 3: 记录当前打包风险**

- 如果仍然出现“大文件警告”，先记入 `PLAN.md` 的技术债，不在这一步顺手做性能优化

**Step 4: Commit**

```bash
git add 拼代代前端文件/src/pages/dashboard/Workspace.tsx PLAN.md
git commit -m "fix: restore frontend typecheck pass"
```

---

### Task 3: 跑通一遍真实主流程，确认不是“代码写着像能用”

**Files:**
- Check: `拼代代前端文件/src/contexts/AuthContext.tsx`
- Check: `拼代代前端文件/src/lib/api.ts`
- Check: `server/src/routes/user.ts`
- Check: `server/src/routes/recharge.ts`
- Check: `server/src/routes/task.ts`
- Check: `server/.env`
- Check: `拼代代前端文件/.env`

**Step 1: 确认环境变量已经填真实值**

- 前端要能连上 Supabase 和后端
- 后端要能连上 Supabase、Storage 和 OpenAI

**Step 2: 启动前后端**

Run:

```bash
cd /Users/jeffo/Desktop/拼代代/server
npm run dev
```

Run:

```bash
cd /Users/jeffo/Desktop/拼代代/拼代代前端文件
npm run dev
```

Expected:
- 前端和后端都能正常启动，没有启动即报错

**Step 3: 按顺序做人肉联调**

1. 注册新账号，确认初始化成功后才能进入工作台
2. 退出再登录，确认登录态能保留
3. 兑换激活码，确认余额和流水立即变化
4. 上传一个最简单的 `.txt` 材料创建任务
5. 等待大纲生成，测试一次修改大纲
6. 确认大纲，观察冻结积分是否正确
7. 等待正文交付，测试下载链接
8. 对已完成任务发起一次降 AI

**Step 4: 把每一步结果记进 `PLAN.md`**

- 成功的改成已完成
- 失败的记清楚卡在哪一步、报什么错

**Step 5: Commit**

```bash
git add PLAN.md
git commit -m "docs: record end-to-end smoke test results"
```

---

### Task 4: 把材料处理改成“原文件直接交给 AI”

**Files:**
- Modify: `server/src/services/fileService.ts`
- Modify: `server/src/services/outlineService.ts`
- Create: `server/src/services/materialInputService.ts`
- Modify: `server/src/types/index.ts`

**Step 1: 抽一个单独的“材料输入服务”**

- 从 Supabase Storage 下载原文件
- 非图片文件：直接上传到 OpenAI Files API，再作为 `input_file` 交给模型
- 图片文件：直接作为视觉输入交给模型
- 请求结束后清理临时上传到 OpenAI 的文件，避免堆积

**Step 2: 让大纲生成直接吃“文件输入”**

- `outlineService` 不再自己对所有文件 `fileData.text()`
- 改成统一走 `materialInputService`
- Prompt 里明确要求模型直接阅读附件文件

**Step 3: 放开前后端的本地格式限制**

- 前端上传区不再只允许固定几种扩展名
- 后端保留数量和大小限制，不再自己判断扩展名
- 如果 OpenAI 接口不支持某种格式，让任务给出明确失败信息

**Step 4: 做最小验证**

Run:

```bash
cd /Users/jeffo/Desktop/拼代代/server
npm run lint
npm run build
```

Expected:
- 后端检查通过
- 至少能确认“文件直接交给 AI”的链路已接通

**Step 5: Commit**

```bash
git add server/src/services/fileService.ts server/src/services/outlineService.ts server/src/services/materialInputService.ts server/src/types/index.ts
git commit -m "feat: send uploaded materials directly to openai"
```

---

### Task 5: 补安全和运营缺口，但排在主流程跑通之后

**Files:**
- Modify: `server/src/middleware/rateLimiter.ts`
- Modify: `server/src/routes/user.ts`
- Modify: `server/src/routes/ops.ts`
- Modify: `PLAN.md`

**Step 1: 处理登录限频“写了但没接”的问题**

- 现在有 `loginLimiter`，但没有真正生效
- 需要决定登录是继续走 Supabase 前端直连，还是改成走后端代理后再限频

**Step 2: 检查运营接口边界**

- 激活码批量生成
- 激活码作废
- 用户禁用/恢复
- 配置项修改

**Step 3: 更新 `PLAN.md` 的安全章节**

- 哪些已完成
- 哪些需要下一轮单独做

**Step 4: 验证**

Run:

```bash
cd /Users/jeffo/Desktop/拼代代/server
npm run lint
npm run build
```

Expected:
- 后端依旧可构建
- 安全限制的实现方式写清楚了，不再停留在“文件里有字但实际上没生效”

**Step 5: Commit**

```bash
git add server/src/middleware/rateLimiter.ts server/src/routes/user.ts server/src/routes/ops.ts PLAN.md
git commit -m "feat: tighten auth and ops safeguards"
```
