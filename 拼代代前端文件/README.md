# 拼代代前端

这个目录是用户看到的网站和后台页面，包括首页、登录注册、工作台、文章修改、文章评审、AI 检测 / 降 AI、历史任务和充值页。

## 本地运行

前提：

- Node.js 22 左右
- 准备好 `.env`，可以从 `.env.example` 拷贝后填写

```bash
cd 拼代代前端文件
npm install
npm run dev
```

默认本地地址：

- `http://localhost:3000`

## 检查和构建

```bash
npm run lint
npm run build
npm run start
```

线上当前跑在 Railway 的 `拼代代前端` 服务上。

## 必需环境变量

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_BASE_URL=
```

`VITE_API_BASE_URL` 必须显式配置。线上建议使用正式 API 域名，例如 `https://api.pindaidai.uk`，不要依赖本地默认地址。
