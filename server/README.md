# 拼代代后端

后端负责业务规则、AI 调用、收费退款、文件处理和清理兜底。用户看到的状态和费用都以后端和 Supabase 数据库为准，前端不能自己决定。

## 本地运行

前提：

- Node.js 22 左右
- 准备好 `.env`，可以从 `.env.example` 拷贝后填写

```bash
cd server
npm install
npm run dev
```

默认本地地址：

- 后端 API：`http://localhost:3001`
- 清理服务：`npm run start:cleanup`

## 常用命令

```bash
npm run lint
npm test
npm run build
npm run start
npm run start:cleanup
npm run repair:wallets
npm run repair:delivery
npm run repair:completed
```

测试框架是 Node.js 自带的 `node:test` 加 `tsx`。不要引入 vitest / jest，除非用户明确要求。

## 部署

线上跑在 Railway：

- `app`：主后端服务
- `cleanup`：清理和兜底服务
- `stealthwriter-worker`：待新增的 StealthWriter 登录维护服务，代码在 `stealthwriter-worker/`

GitHub Actions 推送 `main` 后会触发发布流程；如果临时手动发版，必须在交接记录里写清楚，避免以后从旧代码重新发布把线上退回去。

## 数据库迁移

`supabase/migrations/` 下的 SQL 不会被 GitHub Actions 自动执行。带数据库结构变更时，必须手动在 Supabase 执行，并验证字段已经存在。

执行方式看本机私密文件：

```text
docs/private/deployment-secrets.local.md
```

公开 README 不写真实项目 ID、token 或 service role。

## 关键环境变量

| 变量 | 说明 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase 接入 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | OpenAI Responses API；当前 `OPENAI_MODEL` 只允许 `gpt-5.5` |
| `STEALTHWRITER_BASE_URL` | StealthWriter 地址，默认官方站点 |
| `STEALTHWRITER_WORKER_URL` / `STEALTHWRITER_WORKER_TOKEN` | 常驻 worker 地址和鉴权口令 |
| `ALLOWED_ORIGINS` | 允许访问后端的前端域名，逗号分隔 |
| `OPS_WHITELIST_EMAILS` | 运营白名单邮箱，逗号分隔 |
| `CONFIG_CACHE_TTL_MS` | 系统配置缓存时间 |
| `SENTRY_DSN` | 可选错误监控 |

卡住任务阈值来自数据库配置 `system_config.stuck_task_timeout_minutes`，默认 45 分钟，不是环境变量。

## 详细规则

- 项目规矩：`../agent.md`
- 架构和业务规则：`../DESIGN.md`
- 当前进度：`../PLAN.md`
