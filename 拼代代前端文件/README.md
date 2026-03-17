# 拼代代前端

这是拼代代的前端项目，负责登录、注册、工作台、任务列表、充值页和静态页面。

## 本地运行

前提：

- Node.js 22 左右
- 已准备好 `.env` 或 Railway 变量

命令：

```bash
cd 拼代代前端文件
npm install
npm run dev
```

默认本地地址：

- 前端：`http://localhost:3000`

## 构建和部署

```bash
cd 拼代代前端文件
npm run lint
npm run build
npm run start
```

线上当前跑在 Railway 的 `拼代代前端` 服务上。

## 需要的环境变量

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_BASE_URL=
```
