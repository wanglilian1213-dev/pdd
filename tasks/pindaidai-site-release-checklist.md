# 拼代代网站全面测试后的发布与复测清单

## 当前结论

- 拼代代网站的真实页面和主要业务流程已经测过：首页、登录、工作台、写作、文章修改、文章评审、AI 检测 / 降 AI、我的任务、充值、下载。
- 写作极端场景已经覆盖：医学缺参数、工程缺参数、数据分析、必须画图、评分标准、恶意材料指令、禁联网、引用不足。
- 本地已修复并验证两个线上风险：
  - AI 检测一次上传多个文件时，线上现在会报 500；本地已改成明确提示“AI 检测一次只能处理一个文件，请分批提交。”
  - 独立降 AI 遇到短暂网络/服务抖动时，原来直接失败退款；本地已加自动重试。
- 当前还不能说“线上完全修好”，因为这两个本地修复尚未发布到 Railway 生产环境。

## 不走 GitHub 自动发布的原因

- 当前 `origin/main` 不包含本机已经验证过的 StealthWriter、写作质量闸门等大量代码。
- 如果直接推送或触发 GitHub 自动发布，可能把线上服务换成旧能力，风险比手动发布更大。
- 安全路径是从当前本机已经测试通过的 `server` 目录，手动发布 Railway 的 `app` 和 `cleanup` 两个服务。

## 发布前必须满足

- 得到明确确认：可以发布线上后端。
- 不打印、不保存、不外传任何 Railway token。
- 记录发布代码快照：当前分支、当前提交、`git status -sb` 摘要、后端测试结果、构建结果。
- 发布前再跑一次：
  - `cd server && npm test`
  - `cd server && npm run build`

## 安全发布命令形状

这些命令只说明形状，不包含任何密钥。执行时从本机私密部署文档或环境里读取 `RAILWAY_API_TOKEN`。

```bash
cd /Users/jeffo/Desktop/拼代代/server

railway up . \
  --path-as-root \
  --no-gitignore \
  --ci \
  --project f372a67e-5f11-4c8a-85fd-cd4196eba420 \
  --environment 721bba45-818c-42ee-822c-8ee3cd8bef17 \
  --service 27eeaeed-98b9-4e6d-a9c1-c42305ec1995 \
  --message "manual deploy app after pindaidai site QA"

railway up . \
  --path-as-root \
  --no-gitignore \
  --ci \
  --project f372a67e-5f11-4c8a-85fd-cd4196eba420 \
  --environment 721bba45-818c-42ee-822c-8ee3cd8bef17 \
  --service a2cc1781-db8f-4827-b051-2aef637c8e60 \
  --message "manual deploy cleanup after pindaidai site QA"
```

## 发布后必须复测

- `https://api.pindaidai.uk/health` 正常。
- AI 检测单文件上传仍能正常完成。
- AI 检测多文件上传必须返回 400 和友好提示，不能再返回 500。
- 独立降 AI 用真实文本跑一遍，确认短暂服务波动不会直接把用户流程打断。
- 至少跑 1 个线上极端写作组合题：数据文件 + 图表 + 评分要求 + 引用要求，下载 Word 和引用报告后检查。
- 如果本次发布时间允许，追加 2 个极端题：医学/工程缺参数降级题、恶意材料/禁联网题。
- 下载文件检查不能只看“任务完成”，还要确认 Word 里有真实图片、没有残留图表占位符、没有泄露恶意材料指令。
- 拼代代页面再巡检：首页、登录、工作台、写作、文章修改、文章评审、AI 检测 / 降 AI、我的任务、充值。
- 清理所有临时测试账号、任务、文件、充值码。
- 记录 Railway 部署编号和复测结果到 `tasks/todo.md`。

## 完成标准

- 线上所有关键页面可打开。
- 线上代表性业务流程可从提交走到下载或结果页。
- 已发现的 500 问题在线上消失。
- 线上极端写作组合题下载文件通过复查。
- 临时测试数据清理干净。
- `tasks/todo.md` 记录最终结果。
