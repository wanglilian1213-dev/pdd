# 拼代代开发助手手册

## 沟通方式

和用户沟通时，用中文大白话。可以在实际排查和写代码时保持技术严谨，但汇报时要说清楚“做了什么、结果怎样、还有什么风险”，不要堆术语。

## 项目一句话

拼代代是一个线上写作交付系统：用户上传材料，系统生成大纲和正文，核验引用，交付 Word/PDF，并提供文章修改、文章评审、AI 检测和降 AI。

## 接手先看

优先看这些当前文件：

- `DESIGN.md`：当前架构和业务规则
- `PLAN.md`：当前进度和剩余问题
- `tasks/todo.md`：近期任务和验收记录
- `tasks/lessons.md`：历史纠错经验
- `docs/context-hub.md`：第三方服务查资料规则

如果涉及部署、线上变量、Supabase、Railway、GitHub token，再看本机私密文件：

- `docs/private/deployment-secrets.local.md`

私密文件只在本机使用，不要把密钥、token、账号密码写进公开回复或仓库。

## 当前线上情况

- GitHub 仓库：`wanglilian1213-dev/pdd`
- 默认分支：`main`
- Railway 项目：当前显示名 `PDD`（旧文档名 `glistening-achievement`）
- Railway 当前已有服务：`拼代代前端`、`app`、`cleanup`
- 用户域名：`https://pindaidai.uk`
- 后端域名：`https://api.pindaidai.uk`
- 数据和文件：Supabase
- AI 写作主模型：`gpt-5.5`
- AI 检测 / 降 AI：本地待发布代码已切到 StealthWriter；线上完整接通前要先核对当前部署版本
- StealthWriter worker：代码已加入；正确落点是在同一个 Railway 项目里新增单独服务，不使用其他旧云服务器。当前 Railway 服务清单里还没有这个 worker，新增后还需要给 `app` / `cleanup` 补齐连接变量
- 2026-05-19 核对结果：Railway 当前只有 3 个服务；GitHub `main` 最新提交仍能看到旧检测服务代码。删除线上旧检测变量前，必须先把 StealthWriter 版本发布并验证

## 常用命令

前端：

```bash
cd 拼代代前端文件
npm install
npm run lint
npm run build
npm run start
```

后端：

```bash
cd server
npm install
npm run lint
npm test
npm run build
npm run start
npm run start:cleanup
```

## 技术边界

- 前端：React、TypeScript、Tailwind、Vite
- 后端：Express、TypeScript
- 登录：Supabase Auth
- 数据库和文件：Supabase Database + Storage
- 部署：Railway；不要把新方案写回旧云服务器
- 主 AI 调用：OpenAI Responses API，当前只允许 `OPENAI_MODEL=gpt-5.5`
- AI 检测 / 降 AI：本地待发布代码走 StealthWriter；线上删除旧检测配置前必须先确认已发布新版本

## 业务红线

- 不自建第二套登录系统
- 不让前端自己算钱或自己决定任务状态
- 不能收费失败后不退款
- 不能把密钥写入仓库
- 不能把等待用户操作的状态当成卡死任务清理
- 涉及数据库结构时，代码和线上迁移必须一起核对
- 涉及线上启动变量时，先确认线上代码支持，再改变量

## 工作习惯

1. 动手前先搞清楚目标和完成标准。
2. 只改和任务直接相关的地方。
3. 能用简单方案就不要加复杂抽象。
4. 改完必须验证，不能只靠感觉。
5. 改业务流程、部署方式、数据结构或用户可见文案时，同步更新相关文档。
6. 是否提交、推送、发版，按用户当前要求执行；不要擅自发布。

## 测试要求

- 后端测试：`cd server && npm test`
- 后端类型检查：`cd server && npm run lint`
- 前端类型检查：`cd 拼代代前端文件 && npm run lint`
- 前端生产构建：`cd 拼代代前端文件 && npm run build`
- 线上健康检查：访问后端 `/health`

如果某个验证跑不了，要说明原因，不要假装已经通过。
