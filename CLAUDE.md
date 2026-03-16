# 拼代代 — AI 开发规矩手册

## 项目一句话说明

拼代代是一个网页写作工具。用户上传材料 → 系统生成英文大纲 → 生成英文正文 → 引用核验 → 交付下载 → 可选降 AI。

## 必读文档

开始写任何代码之前，必须先读以下两个文件：

- `DESIGN.md` — 整体设计蓝图，包括技术栈、架构分层、数据流向
- `PLAN.md` — 当前开发进度和待办任务

另外，完整产品需求文档就在同一目录下：
- `拼代代PRD-完整交付版.md` — 所有业务规则的最终来源

## 常用命令

前端代码在 `拼代代最终版/` 文件夹里，运行命令前先进入该文件夹：

```bash
# 进入前端项目目录
cd 拼代代最终版

# 安装依赖
npm install

# 启动开发服务器（端口 3000）
npm run dev

# 构建生产版本
npm run build

# 类型检查（不生成文件，只检查语法）
npm run lint

# 清理构建产物
npm run clean
```

## 技术栈（不可擅自更换）

- 前端框架：React 19 + TypeScript
- 路由：react-router-dom v7
- 样式：Tailwind CSS v4
- UI 组件库：shadcn/ui + Radix UI
- 动画：motion (Framer Motion)
- 图标：lucide-react
- 构建工具：Vite 6
- 后端认证：Supabase Auth
- 后端业务接口：部署在 Railway 上的 Express 服务
- AI 调用：Google GenAI SDK

## 项目文件结构

```
拼代代/                          ← 项目根目录（CLAUDE.md 在这里）
├── CLAUDE.md                    # 本文件：AI 开发规矩手册
├── DESIGN.md                    # 设计蓝图
├── PLAN.md                      # 开发进度表
├── 拼代代PRD-完整交付版.md        # 完整产品需求文档
├── docs/                        # 其他文档
└── 拼代代最终版/                  ← 前端代码目录
    ├── src/
    │   ├── main.tsx              # 应用入口
    │   ├── App.tsx               # 路由配置（所有页面路由在这里定义）
    │   ├── index.css             # 全局样式
    │   ├── components/
    │   │   ├── ui/               # shadcn/ui 基础组件（button, card, input 等）
    │   │   └── layout/           # 页面布局组件（Navbar, Footer, DashboardLayout）
    │   ├── pages/
    │   │   ├── Landing.tsx       # 首页 /
    │   │   ├── Login.tsx         # 登录页 /login
    │   │   ├── Register.tsx      # 注册页 /register
    │   │   ├── ActivationRules.tsx   # 激活规则
    │   │   ├── PrivacyPolicy.tsx     # 隐私政策
    │   │   ├── TermsOfService.tsx    # 服务条款
    │   │   └── dashboard/
    │   │       ├── Workspace.tsx     # 工作台（最核心页面）
    │   │       ├── Tasks.tsx         # 我的任务
    │   │       └── Recharge.tsx      # 账户额度
    │   └── lib/
    │       └── utils.ts          # 工具函数
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    └── .env.example              # 环境变量模板
```

## 路由表（不可擅自新增主路由）

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | Landing | 首页，引导注册登录 |
| `/login` | Login | 邮箱密码登录 |
| `/register` | Register | 真实注册 + 业务初始化 |
| `/dashboard/workspace` | Workspace | 核心工作台，7步流程 |
| `/dashboard/tasks` | Tasks | 历史任务列表 |
| `/dashboard/recharge` | Recharge | 余额查看和激活码兑换 |
| `/activation-rules` | ActivationRules | 静态页 |
| `/privacy-policy` | PrivacyPolicy | 静态页 |
| `/terms-of-service` | TermsOfService | 静态页 |

## 代码风格规则

1. 使用 TypeScript，不写纯 JavaScript
2. 组件用函数式组件 + Hooks，不用 class 组件
3. 样式用 Tailwind CSS class，不写单独的 CSS 文件
4. 组件文件名用大驼峰（如 `Workspace.tsx`），工具文件用小驼峰（如 `utils.ts`）
5. 每个页面组件用 `export default`
6. 所有用户可见的文字用中文

## 绝对不能做的事（红线）

1. **不能推翻现有前端结构**——现有页面和路由已经定型，必须保留
2. **不能自建第二套登录系统**——只认 Supabase Auth
3. **不能让前端自己猜状态**——所有状态必须来自后端真实数据
4. **不能在前端写死业务规则**——收费金额、面值列表等来自后端配置
5. **不能做 PRD 明确说"第一阶段不做"的功能**——参见 PRD 3.2 节
6. **不能让注册成功但初始化失败的用户进入工作台**
7. **不能在收费阶段失败后不退款**

## 修改代码前的检查清单

每次修改代码前，问自己这几个问题：

1. 这个改动是否在 PLAN.md 的当前任务里？
2. 这个改动是否符合 DESIGN.md 里的架构分层？
3. 这个改动涉及的业务规则，在 PRD 里怎么写的？
4. 改完之后，`npm run lint` 能通过吗？
5. 改完之后，`npm run build` 能成功吗？

## 完成代码后必须做的事

1. 运行 `npm run lint` 确认没有类型错误
2. 运行 `npm run build` 确认能正常构建
3. 如果改了业务逻辑，更新 PLAN.md 的进度
