# Download Files After Humanize Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让工作台在降 AI 完成后同时提供正文、核验报告、降 AI 后文章的下载入口，并把下载展示改成统一文件列表。

**Architecture:** 前端先把后端返回的文件记录标准化，再通过一个纯函数生成“要展示的下载项”。工作台第 6 步和第 7 步都复用这个生成结果，只是显示的说明文案不同。这样可以避免 JSX 里继续写死不同文件卡片。

**Tech Stack:** React 19、TypeScript、Vite、Node test (`tsx --test`)

---

### Task 1: 提取文件列表纯函数

**Files:**
- Create: `拼代代前端文件/src/lib/taskFiles.ts`
- Test: `拼代代前端文件/src/lib/taskFiles.test.ts`

**Step 1: Write the failing test**

- 测试 1：后端原始文件记录能被标准化成带 `filename` 的前端文件对象
- 测试 2：同一类型多份文件时，只保留最新一份
- 测试 3：文件展示顺序固定为 正文 -> 核验报告 -> 降 AI 后文章

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/taskFiles.test.ts`  
Expected: FAIL，因为帮助函数文件还不存在

**Step 3: Write minimal implementation**

- 新建文件类型定义
- 实现标准化函数
- 实现“按类型取最新文件”的函数
- 实现“生成下载列表”的函数

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/taskFiles.test.ts`  
Expected: PASS

### Task 2: 改工作台下载区

**Files:**
- Modify: `拼代代前端文件/src/pages/dashboard/Workspace.tsx`
- Reuse: `拼代代前端文件/src/lib/taskFiles.ts`

**Step 1: 让工作台使用标准化后的文件列表**

- 去掉现在 `find(...)` 拿单个文件的写法
- 改成通过帮助函数拿到下载项数组

**Step 2: 把第 6 步和第 7 步都改成列表渲染**

- 第 6 步显示：正文文章、引用核验报告
- 第 7 步显示：正文文章、引用核验报告、降 AI 后文章

**Step 3: 保持现有下载动作不变**

- 仍然点击单个按钮走 `handleDownload(file.id)`

**Step 4: Run lint/build**

Run:
- `npm run lint`
- `npm run build`

Expected: PASS

### Task 3: 回归检查

**Files:**
- Verify only

**Step 1: 手动检查 3 个状态**

- 交付完成、未降 AI：应显示 2 个入口
- 正在降 AI：应仍显示处理中状态
- 降 AI 完成：应显示 3 个入口

**Step 2: Commit**

```bash
git add 拼代代前端文件/src/lib/taskFiles.ts 拼代代前端文件/src/lib/taskFiles.test.ts 拼代代前端文件/src/pages/dashboard/Workspace.tsx docs/plans/2026-03-18-download-files-after-humanize-design.md docs/plans/2026-03-18-download-files-after-humanize.md
git commit -m "fix: keep original downloads after humanize"
```
