# Undetectable 降 AI 接入设计

## 目标

把当前“降 AI”这一步从 OpenAI 改成 Undetectable / OnDetect 官方 Humanization API，同时不改前端交互、不改数据库结构、不改积分和退款的大逻辑。

用户侧保持不变：
- 还是点“一键降 AI”
- 还是看到处理中
- 还是完成后下载 `humanized_doc`
- 还是保留原正文和引用核验报告

## 现状

现在降 AI 在后端 `server/src/services/humanizeService.ts` 里直接调用 OpenAI：
- 输入：正文全文
- 输出：改写后的正文
- 成功后：存 `document_versions`、生成 `humanized_doc`、结算积分、任务回到 `completed`
- 失败后：退款、标失败、记录事件

这条链路外围已经比较稳，不需要推倒重来。

## 推荐方案

采用“后端直连 Undetectable”的方案。

### 为什么不用前端直连

- 密钥不该放到浏览器里
- 现在前端已经有完整按钮和轮询逻辑，没必要再拆一次
- 后端更适合统一处理失败、退款、超时和日志

### 为什么这轮不改数据库

- 当前 `humanize_jobs` 已经能表达“处理中 / 完成 / 失败”
- 这轮重点是换 provider，不是重做任务系统
- 外部文档 ID 这次先不进库，先在一次执行里提交并轮询拿结果

## Undetectable 官方接法

官方文档说明：
- 提交端点：`POST https://humanize.undetectable.ai/submit`
- 结果查询端点：`POST https://humanize.undetectable.ai/document`
- 认证方式：请求头 `apikey: <key>`
- 必填正文参数：
  - `content`
  - `readability`
  - `purpose`
- 可选但本项目要固定的参数：
  - `strength`
  - `model`

### 本项目固定参数

按用户已确认的“更强降 AI”方案固定为：
- `model = v11sr`
- `strength = More Human`
- `readability = University`
- `purpose = Essay`

### 轮询规则

官方文档建议提交后每 `5-10` 秒查一次，直到状态完成。

本项目设计：
- 轮询间隔：`5` 秒
- 最长等待：`10` 分钟
- 完成条件：返回数据里出现可用的 `output`
- 超时或异常：按失败处理并退款

## 环境变量设计

### 保留

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

它们继续只服务主写作链路。

### 新增

- `UNDETECTABLE_API_KEY`

这个值本轮设为必填。

原因：
- `app` 服务需要真实调用 Undetectable
- `cleanup` 服务共用同一套环境检查，缺值时要在启动时直接暴露问题，不要拖到线上跑一半才发现

## 环境加载修正

上轮 review 指出的问题是：`env.ts` 在被导入时就直接读取真实环境，导致测试不干净。

这轮改法：
- 把“加载 `.env` 文件”和“解析环境变量”分开
- `parseEnv(rawEnv)` 继续保持纯函数
- 新增一个单独的运行时加载入口，真正启动服务时再做 `dotenv.config() + parseEnv(process.env)`
- 测试文件只测纯函数，不再依赖本机真实 `.env`

目标：
- 测试更干净
- 线上启动仍然严格校验环境变量

## 代码改动范围

### 新增

- `server/src/lib/runtimeEnv.ts`
  - 负责真正加载 `.env` 并导出运行时环境
- `server/src/lib/undetectable.ts`
  - 负责调用 `/submit` 和 `/document`
- `server/src/lib/undetectable.test.ts`
  - 测官方请求和轮询行为

### 修改

- `server/src/config/env.ts`
  - 只保留纯解析逻辑
  - 新增 `UNDETECTABLE_API_KEY` 校验
- `server/src/config/env.test.ts`
  - 补 `UNDETECTABLE_API_KEY` 的正常 / 缺失校验
- `server/src/services/humanizeService.ts`
  - 改成走 Undetectable
- `server/src/index.ts`
  - 改用新的运行时环境入口
- `server/src/cleanup.ts`
  - 改用新的运行时环境入口
- `server/src/lib/openaiMainConfig.ts`
  - 不改行为，只确保继续只服务主写作链路
- 文档：
  - `agent.md`
  - `DESIGN.md`
  - `server/.env.example`
  - `docs/private/deployment-secrets.local.md`
  - 必要的计划文档说明

## 错误处理原则

这轮按“不要装成功”的原则处理：

- 提交失败：直接失败并退款
- 查询失败：重试到超时，超时后失败并退款
- 返回结果缺正文：失败并退款
- 生成 docx 失败：失败并退款
- 存储失败：失败并退款

任务阶段仍然保持：
- 发起后进入现有的 `humanizing`
- 成功后回到 `completed`
- 失败后也回到 `completed`，但保留失败记录和退款结果

## 测试策略

### 1. 环境变量

- 纯解析函数在假环境里可独立运行
- 缺 `OPENAI_MODEL` 会报错
- 填错 `OPENAI_MODEL` 会报错
- 缺 `UNDETECTABLE_API_KEY` 会报错

### 2. Undetectable 客户端

- 提交时请求头和请求体正确
- 会带上固定参数：
  - `v11sr`
  - `More Human`
  - `University`
  - `Essay`
- 轮询时会在拿到结果前继续等
- 超时会报明确错误

### 3. 降 AI 主流程

- 不再调用 OpenAI
- 成功时会生成 `humanized_doc`
- 失败时会退款并写失败原因

## 验收标准

1. 本地 `npm test`、`npm run lint`、`npm run build` 全通过
2. Railway `app` 和 `cleanup` 都补上 `UNDETECTABLE_API_KEY`
3. 线上发起一次真实降 AI：
   - 进入处理中
   - 最终成功生成 `humanized_doc`
   - 原正文和引用报告仍然能下载
4. 如果 Undetectable 返回错误，系统会明确失败并退款
