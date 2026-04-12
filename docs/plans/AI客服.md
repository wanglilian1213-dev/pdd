# AI 智能客服实现记录

## 日期

2026-04-12

## 变更历史

- 2026-04-12：最初接入 BotPenguin 第三方客服，但因其无法访问用户数据，当天改为自建方案

## 为什么不用 BotPenguin

BotPenguin 是第三方托管的聊天机器人，只能回答预设的通用问题：
- 无法识别当前登录用户的身份
- 无法查询用户的任务、积分、文章等个人数据
- 免费套餐每月只有 1000 条消息
- CDN 不稳定（接入当天出现 503 错误）

用户的核心需求是"客服能看到我的任务数据并针对性回答"，BotPenguin 做不到。

## 自建方案架构

```
用户在聊天窗口输入问题
  ↓
前端把消息 + 登录凭证发给后端 POST /api/chat/message
  ↓
后端验证用户身份（复用现有 authMiddleware）
  ↓
后端查询该用户的数据（钱包、任务、修改记录、系统配置）
  ↓
后端把问题 + 用户数据一起发给 Claude Haiku
  ↓
Claude Haiku 返回针对性回答
  ↓
前端显示回答
```

## 技术配置

- AI 模型：Claude Haiku (`claude-haiku-4-5-20251001`)，通过已有的 Anthropic SDK 调用
- 每用户每天 20 条消息限制（内存 Map 计数，服务重启后归零）
- 聊天记录不持久化，仅存在前端浏览器内存中
- 前端对话历史最多发送最近 10 轮（20 条消息）给 AI 做上下文
- 单条消息长度限制 500 字符
- AI 回复最大 token：1024

## 涉及文件

- `server/src/services/chatService.ts` — 限流、用户数据查询、AI 调用
- `server/src/routes/chat.ts` — API 端点
- `server/src/app.ts` — 路由注册
- `拼代代前端文件/src/components/chat/ChatBubble.tsx` — 浮动气泡主组件
- `拼代代前端文件/src/components/chat/ChatWindow.tsx` — 聊天窗口
- `拼代代前端文件/src/components/chat/ChatMessage.tsx` — 消息气泡
- `拼代代前端文件/src/lib/api.ts` — sendChatMessage
- `拼代代前端文件/src/App.tsx` — 全局挂载 ChatBubble

## 显示规则

- 仅登录用户可见（ChatBubble 内部检查 useAuth）
- 浮动在页面右下角，z-index 为 80
- 不影响现有的人工客服组件（微信二维码弹窗 z-[100]）

## BotPenguin 旧账户信息（已停用）

- 账户邮箱：wanglilian1213@gmail.com
- 已从 index.html 中移除嵌入代码
