# 拼代代后端

负责业务逻辑、AI 调用（OpenAI Responses API + Anthropic Messages API + Undetectable Humanization API）、数据管理、文件处理。

## 本地运行

前提：
- Node.js 22 左右
- 已准备好 `.env`（拷贝 `.env.example` 后填值）

```bash
cd server
npm install
npm run dev
```

默认本地地址：
- 后端 API：`http://localhost:3001`
- 清理服务（独立进程）：`npm run start:cleanup`

## 主要命令

```bash
npm run lint              # tsc --noEmit
npm run build             # tsc 编译到 dist/
npm run start             # 启动主服务
npm run start:cleanup     # 启动清理服务（cleanup runtime）
npm run repair:wallets    # 一次性脚本：补缺钱包
npm run repair:delivery   # 一次性脚本：旧任务交付文件重做
npm run repair:completed  # 一次性脚本：历史坏任务正文重跑
```

## 测试

```bash
# 跑全部测试（必须先 source .env 让测试拿到环境变量）
set -a; source .env; set +a
npx tsx --test src/services/*.test.ts src/lib/*.test.ts
```

测试框架是 `node:test`（Node.js 内置）+ `tsx`（TypeScript 运行器）。**不要**引入 vitest / jest。

## 部署

线上跑在 Railway 项目 `glistening-achievement` 的两个服务：
- `app`（主服务）
- `cleanup`（清理服务）

GitHub Actions 推送 `main` 分支自动发布；详细 CI 配置见 `.github/workflows/`。

## 数据库迁移

`supabase/migrations/` 下的 SQL 文件**不会**被 GitHub Actions 自动跑，每次带 SQL 改动 push 后必须手动执行。两种方式：

1. Supabase Dashboard SQL Editor 粘贴运行
2. 用 supabase Management API（详见 `docs/private/deployment-secrets.local.md`）：
   ```bash
   CLI_TOKEN="<sbp_token>"
   SQL=$(cat supabase/migrations/<file>.sql)
   curl -X POST -H "Authorization: Bearer $CLI_TOKEN" -H "Content-Type: application/json" \
     -d "$(jq -n --arg q "$SQL" '{query: $q}')" \
     "https://api.supabase.com/v1/projects/rjnfctvauewstngqbvrz/database/query"
   ```

跑完用 `information_schema.columns` 查询验证字段存在。

## 环境变量

详见 `.env.example`。关键变量：

| 变量 | 说明 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase 接入 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | OpenAI Responses API（主写作 / 评审 / 主文章识别等） |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | Claude API（文章修改 / 图表增强） |
| `UNDETECTABLE_API_KEY` | 降 AI 服务 |
| `ALLOWED_ORIGINS` | 跨域白名单（逗号分隔） |
| `OPS_WHITELIST_EMAILS` | 运营账号白名单（逗号分隔） |
| `STUCK_TASK_TIMEOUT_MINUTES` | 卡死任务清理阈值，默认 45 |
| `SENTRY_DSN` | 可选，错误监控 |

## 详细规则

业务逻辑、计费规则、各模块行为约束见根目录：
- `../CLAUDE.md` — 全项目规则、技术栈、红线
- `../DESIGN.md` — 架构、数据模型、API 设计
- `../PLAN.md` — 当前进度、已知问题
