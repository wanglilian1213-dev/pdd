# 拼代代 — AI 开发规矩手册

## 项目一句话说明

拼代代是一个网页写作工具。用户上传材料，系统先出英文大纲，用户确认后再生成英文正文、做引用检查、整理交付文件，并且支持二次“降 AI”处理。

## 必读文档

开始动代码前，至少先读这 3 个文件：

- `DESIGN.md`：整体架构和分工
- `PLAN.md`：当前真实进度、下一步和已知问题
- `拼代代PRD.md`：业务规则最终来源

如果这次改动会碰到第三方服务接入，也先看这个文件：

- `docs/context-hub.md`：怎么查最新版第三方资料，避免按旧记忆乱写

如果本机存在这个本地私密文件，接手部署时也先看一眼：

- `docs/private/deployment-secrets.local.md`：线上项目、域名、密钥和环境信息

## 当前线上情况

- Railway 项目：`glistening-achievement`
- 前端服务：`拼代代前端`
- 后端服务：`app`
- 清理服务：`cleanup`
- 前端公开域名：`https://pindaidai.up.railway.app`
- 后端公开域名：`https://app-production-c8a4.up.railway.app`
- GitHub 已有自动发布工作流：
  - 推送 `main` 时自动发布后端 `app`
  - 推送 `main` 时自动发布清理服务 `cleanup`
  - 推送 `main` 时自动发布前端 `拼代代前端`
- 当前运营白名单邮箱：`1318823634@qq.com`

## 常用命令

### 前端

前端代码目录：`拼代代前端文件/`

```bash
cd 拼代代前端文件
npm install
npm run dev
npm run lint
npm run build
npm run start
```

### 后端

后端代码目录：`server/`

```bash
cd server
npm install
npm run dev
npm run lint
npm run build
npm run start
npm run start:cleanup
```

### 第三方资料查询

改 `OpenAI`、`Supabase`、`Vite`、`Express` 这类外部服务或外部库之前，先用 `Context Hub` 查最新版资料，再写代码。它只是开发时查资料用的，不是线上依赖。

```bash
# 先搜有哪些资料
npx -y @aisuite/chub search openai
npx -y @aisuite/chub search supabase

# 再拉具体文档
npx -y @aisuite/chub get openai/chat --lang js
npx -y @aisuite/chub get supabase/client --lang js

# 给资料记本机备注（只记坑和经验，不要记密钥）
npx -y @aisuite/chub annotate openai/chat "这里写项目里踩过的坑"
npx -y @aisuite/chub annotate --list
```

## 技术栈（不可擅自更换）

- 前端框架：React 19 + TypeScript
- 路由：react-router-dom v7
- 样式：Tailwind CSS v4
- UI 组件：shadcn/ui + Radix UI
- 动画：motion
- 图标：lucide-react
- 构建工具：Vite 6
- 认证：Supabase Auth
- 数据和文件：Supabase Database + Storage
- 业务接口：Railway 上的 Express 服务
- AI 调用：OpenAI Responses API（主写作链路统一走 `OPENAI_MODEL=gpt-5.4`；降 AI 暂时单独保留，后续再拆到别的 API）

## 项目文件结构

```text
拼代代/
├── agent.md
├── DESIGN.md
├── PLAN.md
├── 拼代代PRD.md
├── docs/
│   ├── plans/
│   └── private/                    # 本地私密文件，不提交
├── server/
│   ├── src/
│   ├── supabase/migrations/
│   ├── package.json
│   └── .env.example
└── 拼代代前端文件/
    ├── src/
    │   ├── components/
    │   ├── contexts/
    │   ├── lib/
    │   └── pages/
    ├── package.json
    ├── server.cjs
    ├── vite.config.ts
    └── .env.example
```

## 路由表（不可擅自新增主路由）

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | Landing | 首页，引导注册登录 |
| `/login` | Login | 邮箱密码登录 |
| `/register` | Register | 注册 + 初始化 |
| `/dashboard/workspace` | Workspace | 核心工作台 |
| `/dashboard/tasks` | Tasks | 历史任务列表 |
| `/dashboard/recharge` | Recharge | 余额和激活码兑换 |
| `/activation-rules` | ActivationRules | 静态页 |
| `/privacy-policy` | PrivacyPolicy | 静态页 |
| `/terms-of-service` | TermsOfService | 静态页 |

## 代码规则

1. 用 TypeScript，不回退到纯 JavaScript
2. 组件用函数式写法，不用 class 组件
3. 用户能看到的文案统一用中文
4. 前端不自己猜业务状态，真实状态以 Supabase/后端返回为准
5. 收费金额、可修改次数、有效期这些规则，不要写死在前端
6. 改完代码必须重新跑检查

## 红线

1. 不能自建第二套登录系统，只认 Supabase Auth
2. 不能让注册成功但初始化失败的用户进入工作台
3. 不能在收费阶段失败后不退款
4. 不能为了图快，在公开仓库里写入密钥明文
5. 不能推翻现有页面结构和主路由

## 改代码前先检查

1. 这个改动是不是和 `PLAN.md` 当前任务一致
2. 这个改动是不是符合 `DESIGN.md` 的分层
3. 这个改动涉及的业务规则，在 `拼代代PRD.md` 里怎么写
4. 有没有影响线上 Railway 和 Supabase 配置
5. 如果动到第三方 SDK 或接口，先查 `docs/context-hub.md` 和 Context Hub 当前资料

## 完成后必须做

1. 跑 `npm run lint`
2. 跑 `npm run build`
3. 如果动了业务流程、部署方式或真实进度，同步更新文档
