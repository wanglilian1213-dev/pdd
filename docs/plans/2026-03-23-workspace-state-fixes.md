# 工作台状态与下载逻辑修正执行记录

## 本次改动范围

- `server/src/cleanupRuntime.ts`
- `server/src/cleanupRuntime.test.ts`
- `拼代代前端文件/src/lib/taskFiles.ts`
- `拼代代前端文件/src/lib/taskFiles.test.ts`
- `拼代代前端文件/src/lib/workspaceStage.ts`
- `拼代代前端文件/src/lib/workspaceStage.test.ts`
- `拼代代前端文件/src/pages/dashboard/Tasks.tsx`
- `拼代代前端文件/src/pages/dashboard/Workspace.tsx`

## 实际做了什么

### 1. 清理服务

- 新增 `isAutoCleanupStage`
- 只允许 cleanup 处理真正系统自动推进的阶段
- `outline_ready` 会被跳过，不再误杀

### 2. 任务列表下载

- 新增“主文稿选择”纯函数
- 任务列表下载按钮不再看数组最后一个
- 现在固定按：
  - 降 AI 文稿
  - 最终正文
  - 引用报告

### 3. 工作台状态判断

- 抽出工作台状态帮助函数
- 恢复任务时，`delivering` 也会继续轮询
- 第 6 步现在会区分：
  - 正在整理交付文件
  - 交付完成

### 4. 降 AI 启动

- 启动前不再先切第 7 步
- 只有接口确认启动成功才进入第 7 步
- 启动失败时继续留在第 6 步

## 检查结果

### 后端

- `npm test`
- `npm run lint`
- `npm run build`

全部通过。

### 前端

- `npx tsx --test src/lib/taskFiles.test.ts src/lib/workspaceStage.test.ts`
- `npm run lint`
- `npm run build`

全部通过。

## 备注

- 这次没有改接口和数据库
- 这次把工作台状态判断抽成纯函数，主要是为了把“交付中”和“已完成”这类容易打架的逻辑收口到一个地方
