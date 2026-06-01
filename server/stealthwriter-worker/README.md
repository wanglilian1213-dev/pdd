# StealthWriter Worker

这个服务专门负责两件事：

1. 在 Railway 上作为单独服务跑一个长期存在的隐藏浏览器。
2. 自动保持 StealthWriter 登录，并把最新会话写回 Supabase。

当前项目不使用其他旧云服务器。正确落点是在 Railway 项目 `PDD` 里新增一个服务，建议服务名用
`stealthwriter-worker`，服务根目录设置为 `server/stealthwriter-worker`，用本目录的
`Dockerfile` 部署。

## Railway 放置方式

Railway 当前已核对的线上服务是：

- `拼代代前端`
- `app`
- `cleanup`

这个 worker 还没有出现在 Railway 服务清单里。要让 AI 检测和独立降 AI 在本机离线时也能
正常刷新登录状态，需要在同一个 Railway 项目里新增第 4 个服务：

- 服务名：`stealthwriter-worker`
- 服务根目录：`server/stealthwriter-worker`
- 部署方式：Dockerfile
- 持久化目录：给该服务挂一个 Railway Volume 到 `/data`
- 浏览器资料目录：`STEALTHWRITER_PROFILE_DIR=/data/stealthwriter-profile`

worker 部署完成后，把它的线上地址和同一个口令填到 Railway 的 `app` 和 `cleanup` 服务：

- `STEALTHWRITER_WORKER_URL`
- `STEALTHWRITER_WORKER_TOKEN`

## 需要的环境变量

- `PORT`
- `STEALTHWRITER_BASE_URL`，默认 `https://stealthwriter.ai`
- `STEALTHWRITER_EMAIL`
- `STEALTHWRITER_PASSWORD`
- `STEALTHWRITER_PROFILE_DIR`，Railway 上建议 `/data/stealthwriter-profile`
- `STEALTHWRITER_WORKER_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STEALTHWRITER_HEADLESS`，默认 `true`

## 启动

```bash
npm install
npm run dev
```

## 对外接口

所有接口都要求 `Authorization: Bearer <STEALTHWRITER_WORKER_TOKEN>`。

- `GET /health`
- `POST /refresh-session`

`/refresh-session` 会：

1. 打开 StealthWriter
2. 检查当前是否还在登录状态
3. 掉线就自动登录
4. 读取最新 cookie 和 `fp`
5. 写回 Supabase `stealthwriter_session`
