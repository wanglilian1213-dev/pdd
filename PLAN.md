# 拼代代 — 开发进度表

> 最后更新：2026-04-16 (评审异步化 + 中文化)
>
> 这个文件记录当前真实进度、下一步和已知问题。不要再把“已经做完”的内容写成待办。

## 当前阶段

第二阶段收口中：把正式销售前会影响钱、任务一致性和安全性的整改项补齐，同时把登录保护、轮询、跨域、安全头、缓存、审计这些基础骨架补稳。

## 当前交接结论

- 这里不再重复写死提交号；常规发布默认看 GitHub `main`，如果当天做过直接线上热修，就以 `docs/plans/2026-03-30-final-release-state.md` 里的最近一次核对记录为准
- 2026-04-03 已完成这轮最小修补的本地落地和核对：
  - `cleanup` 服务现在会打印独立入口标识，方便线上确认跑的是清理进程
  - 老材料清理只会处理已经结束任务留下来的材料，不会碰还在 `processing / outline_ready` 的任务
  - `/api/user/init` 已改成“档案 / 钱包缺哪补哪”，重复初始化不会再把半残账号直接放过
  - 已补一次性缺钱包修复脚本：`npm run repair:wallets`
  - 这轮修补已经直接发布到 Railway `app` 和 `cleanup`
- 2026-03-31 已用桌面这 3 个任务要求 PDF 跑过真实线上任务，确认：
  - 任务主题不会再被评分标准 / 写作指南带偏
  - 正式题目会优先贴着任务本身，而不是沿用 `Report Marking Criteria`
  - 当时线上前端、后端、清理服务都已经是当时主线的最新版本
- 下一位 agent 接手时，优先看这 5 个文件就够了：
  - `CLAUDE.md`
  - `PLAN.md`
  - `DESIGN.md`
  - `docs/plans/2026-03-30-final-release-state.md`
  - `docs/private/deployment-secrets.local.md`

## 已完成

### 前端基础

- [x] 首页、登录、注册、工作台、任务列表、账户额度、静态页
- [x] 主路由和 dashboard 路由守卫
- [x] `AuthContext` 和登录态保持
- [x] 注册后调用后端初始化
- [x] 初始化失败时前端退出登录，阻止半初始化账号进入工作台
- [x] 任务列表下载按钮改成“主文章优先”
- [x] 登录 / 注册页客服入口改成真实可用弹窗
- [x] 首页和充值页已替换为真实客服二维码
- [x] 已补正式 404 页面
- [x] 前端改成只从环境变量读取 Supabase 地址和公开 key
- [x] 自建 AI 智能客服（替代 BotPenguin），支持查询用户任务/积分数据针对性回答
- [x] 前端请求统一状态码检查和非 JSON 容错
- [x] 前端静态服务基础安全头
- [x] 登录失败本地冷却保护
- [x] 注册密码强度提升到“至少 8 位且同时包含字母和数字”
- [x] 工作台轮询改成“逐步放慢 + 总超时”

### 后端基础

- [x] Express + TypeScript 服务搭建
- [x] 后端应用工厂（安全头 + 跨域白名单）
- [x] Supabase JWT 鉴权中间件
- [x] 账号状态检查中间件
- [x] 运营白名单中间件
- [x] Supabase 数据库初始化脚本
- [x] Supabase RLS 门禁策略
- [x] 钱包 / 激活码 / 大纲确认 / 降 AI 启动的数据库原子操作
- [x] 激活码改成系统级安全随机数
- [x] 关键后端环境变量强校验（含 `OPENAI_MODEL`、`ALLOWED_ORIGINS`）
- [x] 系统配置短时缓存
- [x] 结构化审计日志骨架
- [x] 可选错误监控骨架（`SENTRY_DSN`）
- [x] `/api/user/init` 改成幂等修补：账号档案 / 钱包缺哪补哪
- [x] 已补“扫描缺钱包账号并补零余额钱包”的一次性修复脚本：`npm run repair:wallets`

### 钱包和激活码

- [x] 激活码兑换接口
- [x] 余额读取
- [x] 积分流水读取
- [x] 充值页接通真实数据

### 任务主流程

- [x] 创建任务
- [x] 上传文件到 Supabase Storage
- [x] 上传中途失败时自动清理半成品文件和任务
- [x] 当前任务查询
- [x] 任务详情查询
- [x] 任务列表查询
- [x] 大纲生成
- [x] 大纲修改次数限制
- [x] 确认大纲后冻结积分
- [x] 正文生成主链路（写作 → 字数矫正 → 引用核验 → 交付）
- [x] 第一次正文生成额外带上强约束写作规则（整篇一次写完、所有章节都写、只写段落、强调批判性论证和具体证据）
- [x] 失败退款主链路
- [x] 交付文件上传失败时中断流程，不再继续结算
- [x] 结果下载链接生成
- [x] 任务列表单按钮下载固定为主文稿优先（降 AI 版 → 最终正文 → 引用报告）
- [x] 正文交付改成正式 Word 排版（Times New Roman 12、标题居中加粗、1.5 倍行距、参考文献悬挂缩进）
- [x] 引用核验报告改成 PDF 交付
- [x] 最终正文 Word 改成封面页 + 正文页 + Reference 单独新页
- [x] 课号在第一次生成大纲时自动提取并保存，提取不到时允许留空继续
- [x] 正式题目和研究问题在第一次大纲生成时一起产出并落库，后面正文生成、封面、下载文件名、报告标题统一优先用正式题目
- [x] 最终正文下载文件名优先改成正式题目；只有老任务还没补出正式题目时才回退旧任务标题
- [x] 多行 reference 不再被错拆成两条
- [x] 核验报告 PDF 改成按真实内容自动长高和分页，不再靠写死高度
- [x] 默认标题如果来自上传文件名，会先去掉 `.txt/.pdf/.docx/.doc` 这类真实后缀，再用于封面标题和最终 Word 文件名
- [x] 封面标题和正文第一页第一行如果只是直引号 / 弯引号或空格差异，也会被当成同一个标题去重，不再重复印两次
- [x] 正文生成 / 字数矫正 / 引用修正 3 步统一禁止 Markdown 样子输出；最终导出 Word 前再把残留 md 痕迹转成真正的粗体 / 斜体 / 标题样式
- [x] 已补“旧任务只重做交付文件”的补救脚本，不重跑 AI、不重新扣费
- [x] 大纲阶段增加“正式题目 + 研究问题 + 空壳占位词”检查，不再让评分标准名和 `[Research Question]` 一路流进正文
- [x] 大纲阶段新增“主题是否跑偏”的二次复查：题目和研究问题必须优先贴着任务要求本身；评分标准和写作指南只能补充结构、写作、引用和评分要求，不能抢走正文主题
- [x] 第一次正文如果拒答或没有引用，会自动带全量上下文重跑一次；后两步如果把正常版本改坏，会退回最后一个正常版本
- [x] 字数矫正改成只按正文部分计数，不把标题和参考文献算进去；目标范围固定为正负 10%，并且在这一段内部最多自动重试 5 次
- [x] 已补“旧坏任务自动补救”脚本：标题脏只重做文件，内容脏会修大纲并不重复收费地重跑正文链路
- [x] 交付中刷新页面仍显示“正在整理交付文件”，不再冒充已完成
- [x] 降 AI 启动失败时留在第 6 步，不再误显示”降重完成”
- [x] 图表增强从”强制至少 1 图”改成”按需智能判断”：任务要求和大纲会传给 AI 做决策依据；图表需要有真实数据或任务明确要求才加；表格门槛更低，有对比性内容即可加

### 降 AI

- [x] 发起降 AI 接口
- [x] 降 AI 冻结、结算、失败退款
- [x] 工作台前端入口已接上
- [x] 降 AI 已切到 Undetectable Humanization API
- [x] 降 AI 增加参考文献保护：Undetectable 只收正文，References 在发送前分离、处理后原样拼回，避免第三方黑箱服务破坏学术引用格式
- [x] 降 AI 切走再切回工作台不再丢状态：`getCurrentTask` 改三查询（写作中 → humanizing 双重校验 → 未确认 humanize 兜底），覆盖进行中 / 已完成 / 失败三种状态
- [x] 降 AI 失败时工作台 step 7 显示红色失败卡 + 真实 `failure_reason`，不再误显示绿色"降重完成"
- [x] 用户主动点"完成并创建新任务"时调 `POST /api/task/:id/acknowledge-humanize` 把当前 task 所有 humanize_jobs 标 `acknowledged=true`，下次切回工作台不再恢复
- [x] 卡死的降 AI（进程崩溃留下的 `status=processing`）由 `cleanupStuckHumanizeJobs` 兜底：超过 45 分钟自动 refund + 标 failed + 重置 task.stage，并保持 `acknowledged=false` 让用户下次切回看到失败提示

### 文章修改（独立功能，2026-04-06 上线）

- [x] 数据库迁移：`revisions` + `revision_files` 表 + `revision_price_per_word` 配置（2026-04-17 起改名，原字段为 `revision_price_per_1000`）
- [x] 后端：Anthropic SDK 接入，`claude-opus-4-6-20250414` 开启 extended thinking
- [x] 成本优化：客服聊天/降AI压缩/格式修复/润色 改走 GPT-5.4；图表后压缩 改走 claude-sonnet-4-6
- [x] 后端：`revisionService` + `revisionMaterialService` + `routes/revision.ts`
- [x] 前端：侧边栏 `/dashboard/revision` 入口 + `Revision.tsx` 三状态页面（输入 / 处理中 / 完成）
- [x] 计费：0.2 积分/字（精确按字、向上取整），复用现有 wallet RPC（freeze → settle → 差额 refund）。注：2026-04-17 全项目计费切换到「按字精确计费」，旧值是 250 积分/1000 字。
- [x] 同一时间一个用户只能一个 processing（唯一部分索引兜底）
- [x] 失败自动退款：上传失败、API 失败、Word 生成失败都走 refund + 标记 failed
- [x] settle 顺序：所有副作用（storage、DB 写）稳定落库后才结算，避免"失败单已收费"
- [x] 卡死兜底：cleanup 服务新增 `cleanupStuckRevisions`，超时自动 refund + failed
- [x] Railway `app` + `cleanup` 已配置 `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`
- [x] 2026-04-17：字数估算修复 + 增量预估 + 友好余额提示
  - 旧 bug：6.5MB PDF 按 `file.size/6` = 108 万字 → 21 万积分，用户 2 万多积分被错报"余额不足"
  - 后端：PDF 真用 pdf-parse 解析（30s 超时 + isMostlyGarbage 扫描件检测）；DOCX/TXT/MD 真解析不再加 1.2 缓冲；图片每张固定 100 字（约 20 积分）
  - 后端：新增 `POST /api/revision/estimate`（multer.single('file')）单文件增量预估
  - 后端：`createRevision` 在 INSERT revision 之前用 `getBalance` 做余额前置校验，不够直接抛带数字的 `InsufficientBalanceError({ required, current })`，不写库不冻结
  - 后端：扫描件 PDF 在 estimate / create 两个入口都拒绝，不写库不冻结
  - 前端 `Revision.tsx`：维护 `Map<File, words>` 增量累加，文件变化时实时显示「预估字数 X / 预估冻结 X 积分」；余额不足时禁用提交按钮 + 红字「需要 X 积分，您当前余额 X 积分，请先去充值」
  - 前端：提交前 `api.getProfile()` 拉一次最新余额再校验
  - 友好的余额不足提示：`InsufficientBalanceError` 改造支持可选 `{ required, current }` 参数，向后兼容
  - 单元测试：新增 9 条 `revisionService.test.ts`（图片 100 字、txt/md 真字数、扫描件 PDF 兜底、汇总并行、关键回归）

### 文章评审（独立功能，2026-04-15 上线）

- [x] 数据库迁移：`scorings` + `scoring_files` 表 + `scoring_price_per_word` 配置 + 部分唯一索引 `WHERE status='processing'`
- [x] `opsService.validateConfigValue` 新增小数配置校验分支，支持 `scoring_price_per_word` 这类小数配置
- [x] 后端：`scoringMaterialService` 精确字数提取（CJK 逐字 + 西文切词）+ 文件角色预判 + 扫描件 / 纯图片前置拒绝
- [x] 后端：`scoringPromptService` 组装 SYSTEM/USER prompt + JSON 软校验（parseScoringJson + validateScoringJson）
- [x] 后端：`scoringService` 主流程（建单 → 冻结 → 异步执行 → 结算 → 差额退款 / 失败全额退款）
- [x] 后端：`scoringPdfService` 按 GPT JSON 渲染 PDF 评审报告（pdfkit + Times-Roman 12pt + 自动分页）
- [x] 后端：`routes/scoring.ts` 5 个接口（create / current / list / detail / download）
- [x] `openaiMainConfig.ts` 新增 `scoring` 阶段，reasoning effort `high`，不加入 `stagesWithWebSearch`
- [x] AI 调用：OpenAI Responses API，`gpt-5.4`，20 分钟单次超时，JSON 格式错一次重试 1 次
- [x] 计费：0.1 积分/word；汉字按字、英文按词；冻结按所有上传文件精确字数总和；结算按 GPT 识别为 `article` 文件的精确字数，`clamp(0, input_word_count)` 兜底
- [x] 分数锚点：75-84 为"良好（符合要求即应落此区间）"写进 SYSTEM prompt；容忍度清单覆盖少量拼写错误、长句、非顶刊合法引用、语态风格偏好
- [x] 同一时间一个用户只能一个 processing（唯一部分索引兜底）
- [x] 失败自动退款：扫描件 / 纯图片前置拒绝时回退冻结；API 失败、JSON 两次解析失败、PDF 生成 / storage 上传 / DB 写失败都走 refund + 标记 failed
- [x] settle 顺序：所有副作用（PDF、storage、DB 写）稳定落库后才结算；`alreadySettled` 标志兜底
- [x] 卡死兜底：cleanup 服务新增 `cleanupStuckScorings`，超过 45 分钟自动 refund + failed
- [x] 前端：侧边栏 `/dashboard/scoring` 入口（图标 `Gauge`）+ `Scoring.tsx` 四状态页面（输入 / 处理中 / 完成 / 失败）
- [x] 前端：`Tasks.tsx` 新增第 3 个 tab "评审记录"，懒加载策略（切到才请求、同 tab 切回用缓存）
- [x] 前端：轮询 `首次 5s → 每次 +3s → 封顶 15s → 总超时 25 分钟`
- [x] 前端：上传阶段只按扩展名和大小展示，不在前端猜文件角色（避免前后端矛盾）
- [x] 完成态交互：总评 / 分维度两个内嵌 tab，分维度卡片显示权重%、分数、优点/不足/建议 bullets；顶部总分徽章 + 改进建议清单；右上角下载 PDF 按钮
- [x] 新增依赖：`pdf-parse@^1.1.1`（用于扫描件 PDF 检测）
- [x] 单元测试：`scoringMaterialService.test.ts` + `scoringPromptService.test.ts` + `scoringService.test.ts` + cleanup 更新，共 96+ 条测试
- [x] 文档同步：`CLAUDE.md` / `DESIGN.md` / `PLAN.md` / `docs/plans/2026-03-30-final-release-state.md` 全部更新；历史 `agent.md` 引用清理为 `CLAUDE.md`

### 线上环境

- [x] Railway 已有项目 `glistening-achievement`
- [x] Railway 已有 `app`、`cleanup`、`拼代代前端` 三个服务
- [x] 前端线上域名可访问
- [x] 后端 `/health` 正常
- [x] 主写作链路统一使用 OpenAI Responses API + `gpt-5.4`（已改为 streaming 模式避免 Cloudflare 524 超时）
- [x] `cleanup` 服务启动时会打印独立入口标识，便于线上核对是否真的跑在清理入口
- [x] Railway `cleanup` 服务启动命令已核对为 `npm run start:cleanup`
- [x] 清理服务不再误杀 `outline_ready` 的待确认大纲任务

## 正在做

- [x] 运营接口联调
- [x] 登录限频方案收口
- [x] GitHub 到 Railway 的自动部署整理

## 接下来要做（按优先级）

### 优先级 1：先把当前项目收干净

- [x] 修复前端 `npm run lint` 报错
- [x] 删除过时文件和重复文件
- [x] 把旧文档里错误的目录名、文件名、技术栈说明全部改正

### 优先级 2：核对线上配置和数据库

- [x] 检查 Railway 三个服务的变量是否齐全
- [x] 检查 Supabase 线上表结构是否和代码一致
- [ ] 检查 Storage bucket 和关键配置是否齐全
- [x] 核对线上部署到底对应当前哪一版代码
- [ ] Railway / 前端 / 后端真实线上环境变量补齐 `ALLOWED_ORIGINS`、`CONFIG_CACHE_TTL_MS`、`SENTRY_DSN`

### 优先级 3：跑一遍真实主流程

- [x] 注册新账号
- [x] 登录
- [x] 兑换激活码
- [x] 上传最小材料创建任务
- [x] 等待大纲生成并测试一次修改
- [x] 确认大纲，检查冻结积分
- [x] 等待正文完成，测试下载
- [x] 发起一次降 AI

### 优先级 4：把材料处理改成“原文件直接交给 AI”

- [x] 后端不再把二进制文件硬读成文本
- [x] 文档类文件改为直接上传给 OpenAI Files API
- [x] 图片类文件改为直接作为视觉输入交给 OpenAI
- [x] 前后端去掉本地格式白名单，失败时交由接口明确报错

### 优先级 5：补安全和运营细节

- [x] 登录限频真正接上（前端本地冷却保护；真实登录入口仍由 Supabase 托管）
- [x] Supabase 公开表访问门禁补上
- [x] 充值 / 扣费 / 启动任务的并发一致性补上
- [x] 运营接口联调
- [x] 激活码批量生成和作废核验
- [x] 禁用 / 恢复账号核验
- [x] 服务端目标字数 / 修改意见 / 任务列表状态参数校验
- [x] 字数、引用格式、最少引用数量、章节数量统一收口成一套任务要求结果
- [x] 确认大纲不再允许覆盖字数和引用格式
- [x] 大纲章节数量检查改成按真实多行内容计数，不再把正常的 3 章大纲误杀成 1 章
- [x] 正文、字数矫正、引用修正统一带上最少引用数量和 2020+ 学术论文要求
- [x] 正文最低检查升级为“有引用 + 有参考文献 + 数量/年份/类型/格式不过于离谱”
- [x] 引用核验报告开始围绕数量、年份、类型和格式输出规则检查
- [x] 正文链路超时重新调大：正文初稿 `30` 分钟、字数矫正每次 `15` 分钟、引用修正每次 `20` 分钟、总兜底 `45` 分钟
- [x] 后端跨域白名单
- [x] 后端基础安全中间件
- [x] 依赖安全检查 GitHub 工作流

### 优先级 6：把上线流程正规化

- [x] 把 GitHub 仓库和 Railway 部署链路理顺
- [x] 明确前端和后端各自的根目录、构建和启动方式
- [x] 让后续更新不再靠手工猜

## 已知问题和技术债

- 虽然材料已经改成“原文件直接交给 AI”，但还需要补一轮多格式线上回归，确认接口对冷门格式的报错文案是否足够清楚
- 前端构建产物体积偏大，打包有 chunk warning
- 注册后首次进入工作台的偶发 `403` 已在前端时机上修正，仍需再做一次线上回归确认没有漏网情况
- 降 AI 已经单独切到 Undetectable；后面只剩参数是否做成后台可调的问题
- 交付文件已经补到“封面页 + 正文页 + Reference 新页 + 专业 PDF 报告”，后面还需要继续观察不同学校模板要求下是否要加页码、目录、姓名、日期等更细格式
- 历史脏任务如果要补救，现在必须显式跑：
  - `npm run repair:delivery -- <taskId...>`：只重做交付文件
  - `npm run repair:completed -- <taskId...>`：修正式题目 / 修空壳大纲 / 不重复收费地重跑正文
- 结构化审计日志和错误监控骨架已补，线上还要确认是否真的启用 `SENTRY_DSN`

## 更新记录

| 日期 | 更新内容 |
|------|----------|
| 2026-04-16 | 修复降 AI 切走再切回工作台状态丢失（主 bug + 6 个连锁 bug 一起修）：(1) 主 bug —— `getCurrentTask` 之前只查 `status='processing'`，但降 AI 全程 `task.status='completed'`，所以三种降 AI 状态（进行中 / 已完成 / 失败）切回都被漏掉；改成三查询（写作中 → humanizing 双重校验 → 未确认 humanize 兜底），双重校验失败时显式 fallthrough 到查询 3 处理陈年 stage 残留；(2) `workspaceStage.getWorkspaceStep` 加 `'failed' → step 7`，避免失败 humanize 切回掉到 step 6 显示绿色"交付完成"；(3) `Workspace.tsx` step 7 UI 从 2 分支（处理中 / 完成）扩成 3 分支（失败 / 处理中 / 完成），失败分支显示红色 AlertCircle 卡 + `humanizeJob.failure_reason` 真实文案 + 仍可下载 final_doc / citation_report；(4) `HumanizeJob` interface + `reshapeTaskResponse` 保留 `failure_reason` 字段（之前丢字段导致永远显示 fallback 文案）；(5) `startHumanizePolling` 收到 `task.status='failed'` 补 `setIsStartingHumanize(false)`（之前 spinner 永远转）；(6) `startHumanizePolling` 新增 `humanizeJob.status='failed'` 分支（之前要等 client-side 超时才停）；(7) 新增 `humanize_jobs.acknowledged` 字段（migration 用 DEFAULT true 把 16 条老数据 backfill 成已确认，再 SET DEFAULT false 让新数据未确认）+ 部分索引 `idx_humanize_jobs_unacknowledged WHERE acknowledged=false`；新增 `acknowledgeHumanize` service + `POST /api/task/:id/acknowledge-humanize` 路由；前端 `handleNewTask` 改 async，dismiss 时先调 ack API；(8) cleanup 服务新增 `cleanupStuckHumanizeJobs`（B6 修复，原 `cleanupStuckTasks` 内 humanizing 分支是死代码因为外层只查 `status='processing'`），超过 `stuck_task_timeout_minutes`（默认 45 分钟）的 stuck humanize_jobs 自动 refund + 标 failed + 重置 task.stage 并保持 acknowledged=false。新增 9 条后端测试 + 1 条前端测试 |
| 2026-04-17 | 全项目计费规则改版：4 个收费链路（正文/降AI/修改/评审）统一改为「按字精确计费 cost = ceil(字数 × 单价)」，字段从 `*_per_1000`（整数）重构为 `*_per_word`（小数）；新单价 — 正文 0.1、降 AI 0.4、文章修改 0.2、评审 0.1（评审本来就是这个算法）；migration `20260417000000_pricing_per_word.sql` 删旧 3 个 per_1000 配置 + 写入新 3 个 per_word 配置；`opsService` 把 3 个新 key 加进 `POSITIVE_NUMBER_CONFIG_KEYS`，原 `POSITIVE_INTEGER_CONFIG_KEYS` 同步移除；`outlineService` / `humanizeService` / `revisionService`（含 createRevision 冻结 + finalizeRevision 结算 2 处）/ `chatService`（客服 AI 上下文 2 处）全改算法和字段名；冻结/结算/失败退款流程不变；前端 Revision.tsx 和 Scoring.tsx 删除静态价格文案，改成「详细计费规则见首页常见问题」；Landing FAQ 替换 Q5「自动降AI如何计费」为综合 Q「各项功能是怎么收费的？」覆盖 4 个功能的精确单价 + 字数口径 + 失败退款，FAQ 渲染容器加 `whitespace-pre-line` 让换行符生效，作为对外唯一价格展示位 |
| 2026-04-16 | 评审（Scoring）异步化 + 中文化一步到位：(1) `createScoring` 拆分——POST 接口只做 multer 收 + 上传 raw 到 Storage + INSERT `status='initializing'` 立即返回（秒回，消除 "Failed to fetch"），pdf-parse + 冻结积分 + 启动 GPT 全部移到后台 `prepareScoring` 阶段；DB 扩 `scorings.status` 加入 `'initializing'`，唯一部分索引扩到覆盖 `initializing + processing`；(2) `extractFileText` PDF 分支加 30 秒硬 timeout + 错误兜底（pdf-parse 抛错按扫描件处理）；(3) Prompt `SCORING_SYSTEM_PROMPT_EN` Language 段改硬规则：overall_comment / strengths / weaknesses / suggestions / top_suggestions 全部简体中文，维度名保留 rubric 原文（或默认英文五维度名）；(4) `scoringPdfService` 全面中文化（标题"学术评审报告"、"总体评价"、"分维度评分"、"优点/不足/建议"、"优先改进建议"、"识别到的材料"等），嵌入 `server/fonts/SourceHanSansCN-Regular.otf` 字体（8MB，OFL 开源）解决 pdfkit CJK 方块问题；(5) `cleanupRuntime` 扩展：`cleanupStuckScorings` 覆盖 initializing（不 refund，清 Storage + 标 failed）；新增 `cleanupExpiredScoringMaterials`（3 天过期材料清理）和 `cleanupExpiredScoringReports`（过期 PDF 报告清理），补此前 `cleanupExpiredMaterials` 只扫 `task_files` 不扫 `scoring_files` 的漏洞；(6) 前端 `api.ts createScoring` 加 60 秒 AbortController + 中文化"Failed to fetch"为"上传超时/网络不稳定/文件过大"；`Scoring.tsx` 类型 + 轮询 + UI 支持 initializing 状态，显示"正在验证材料（通常 30-90 秒）" |
| 2026-04-16 | 主流程 4-Bug 修复：(1) Draft prompt "approximately ${words}" 改成 "MUST between ${min} and ${max}, do NOT exceed" 硬约束，解决 1000 字任务初稿出 1580 字（+58%）的问题；(2) Calibration prompt 加结构保留规则，接受 `draftHeadings` 参数作为 ground truth，每次重写都基于原始 draft 的 heading 列表恢复，避免多轮压字时 heading 累积丢失；(3) `runWordCalibrationAttempts` 5 次全失败时两段式挑最优候选（先过滤 heading 数达标，再按字数距离排序），不再返回最后一次；(4) `outlinePromptService` 删掉传给 GPT 的公式，改成"系统会算、你返回 null"；`deriveUnifiedTaskRequirements` 新增 `structureEvidence` 白名单 + `trustSectionCount` 显式旁路：只有 GPT 能从材料里 quote ≥25 字含 "section/chapter" 关键词的原文时才采纳 GPT 返回的 section count，否则强制回退公式；老的 DB 恢复和用户手动 override 路径显式 `trustSectionCount: true` 不受影响；(5) `documentFormattingService.isHeadingBlock` 扩展正则识别 "Section N: ..." / "Chapter N. ..." 格式，新增 `extractBodyHeadingLines` / `countBodyHeadingLines` 共享 util；(6) Chart enhancement 新增 heading 数量回退检查：返回的文本 heading 数掉到 `原始 - 1` 以下直接丢弃 chart 增强版本回退原文；`postChartCondense` prompt 加 heading 保留约束；(7) Draft prompt 新增 DOI/URL 完整性规则：web_search 没验证过的 URL/DOI 一律不写，优先 `https://doi.org/<DOI>` 规范形式，无法验证时整条 URL 字段直接省略，杜绝"GPT 幻觉 DOI + 系统从不验"导致的 404 reference。新增 5 条单元测试覆盖公式强制、evidence 白名单、trust 旁路、最优候选、heading 优先排序。全量测试 262/263 pass（1 个失败是之前就存在的 citation report test，跟本次无关） |
| 2026-04-15 | 文章评审（Scoring）功能上线：新增 `/dashboard/scoring` 独立主路由，用户上传文章 + 可选 rubric/brief，GPT-5.4 按学术导师标准模拟评审并生成 PDF 报告；计费 0.1 积分/word（汉字按字、英文按词）；新增 `scorings` + `scoring_files` 表和 `scoring_price_per_word` 配置，部分唯一索引保证并发安全；SYSTEM prompt 明确 75-84 分锚点防止 AI 吹毛求疵；前置拒绝扫描件和纯图片上传；新增 `pdf-parse` 依赖；Tasks 页新增"评审记录" tab；所有文档里的 `agent.md` 引用清理为 `CLAUDE.md` |
| 2026-04-13 | 降 AI 增加参考文献保护：在 Undetectable 处理前分离 References 部分，只发正文降 AI，处理完拼回原始参考文献，避免第三方服务破坏学术引用格式 |
| 2026-04-12 | 图表增强从强制加图改成智能判断：prompt 改为三步决策框架（先判断是否需要图表、再判断是否需要表格、都不需要就不改）；调用时传入任务特殊要求和大纲内容作为决策依据 |
| 2026-04-11 | 修复文章修改"余额不足"误报：`estimateWordCount` 对 DOCX 改成用 mammoth 提取真实字数（原来用文件体积 ÷ 8 会高估 3-5 倍），TXT/MD 也改成直接读 buffer 计数，加 20% 缓冲和 500 字兜底 |
| 2026-04-03 | 补齐 `1 / 3 / 5` 最小修补：`cleanup` 服务新增独立入口标识并把材料清理范围收紧到已结束任务；`/api/user/init` 改成“缺哪补哪”；新增 `npm run repair:wallets` 一次性补钱包脚本；主文档不再多处写死旧提交号 |
| 2026-04-03 | 根据最近真实失败记录重新放宽正文链路超时：正文初稿改为 `30` 分钟，字数矫正每次 `15` 分钟，引用修正每次 `20` 分钟，卡住任务总兜底改为 `45` 分钟；同时把最终正文存储路径改成稳定安全名字，避免标题里带特殊符号时在最后交付阶段失败 |
| 2026-03-31 | 交接前又做了一轮真实线上验收：直接用桌面上那 3 个任务要求 PDF 新建任务，确认当时 `main` 最新版本下，正式题目会优先贴着真实任务主题，不再被 `Report Marking Criteria.pdf` 带偏；前端、后端、清理服务线上状态都正常 |
| 2026-03-30 | 修掉“第一次正文生成会无限卡在 writing”这个新阻塞点：正文第一步现在也有超时兜底；随后又用桌面那 3 个 PDF 实测，确认这一步真实耗时可达 7 分钟左右，因此把这一步单独放宽到 10 分钟，避免把本来能成功的任务提前判死 |
| 2026-03-31 | 修掉“评分标准 / 写作指南把任务主题带偏”这条坏链路：大纲提示明确要求先从任务要求材料里找真正主题；如果材料只给范围或选题空间，允许模型自己定具体题目，但必须严格贴题；大纲生成后再做一次主题复查，跑偏先自动修，修不回来才失败；旧坏任务如果只是文件名脏继续只重做文件，但如果内容方向已经跑偏，就按内容脏补救重跑正文 |
| 2026-03-30 | 字数矫正这一步收紧成“只算正文、不算标题和参考文献、严格卡在正负 10%”，并在这一段内部最多自动重试 5 次；第 5 次仍未命中范围时，按当前业务要求继续往后走，不在这次顺手改后续环节 |
| 2026-03-30 | 修掉“正常多行大纲被系统误判成 1 章”这个线上阻塞点：章节数量检查改成按真实换行后的章节标题计数，不再先把换行抹平后再判断 |
| 2026-03-30 | 仓库最终收口：删除历史计划文档、外部 worktree 残留和死代码 `loginLimiter`，只保留当前最终版说明与主分支 |
| 2026-03-30 | 修掉“评分标准文件名一路变成最终标题 + 正文拒答还被扩写成交付稿”这条坏链路：正式题目和研究问题在大纲阶段生成并锁定；空壳大纲先自动修再决定是否失败；正文第一次拒答或无引用时先自动重跑；后两步如果把正常文章改坏就退回最后一个正常版本；补上旧坏任务 `repair:completed` 补救脚本 |
| 2026-03-30 | 修掉最终正文 `.txt` 标题污染和 md 文本泄漏：默认标题在创建任务和交付导出两处都先去真实文件后缀；正文生成 / 字数矫正 / 引用修正统一禁止 md 样子输出；Word 导出改成真正的行内粗体 / 斜体 / 标题转换；补上旧任务只重做交付文件的补救脚本 |
| 2026-03-30 | 正文最终交付改成封面页 + 正文页 + Reference 新页；课号在首次大纲生成时自动提取并落库；最终 Word 文件名改成任务标题；多行 reference 合并规则修正；核验报告 PDF 改成按真实内容自动分页，解决长内容重叠 |
| 2026-03-30 | 补上销售前整改骨架：激活码安全随机、大纲修改原子占位、前端不再写死真实 Supabase 兜底、后端应用工厂 + 跨域白名单 + 安全中间件、工作台轮询退避 + 超时、注册密码和登录保护加强、配置缓存 / 审计日志 / 可选错误监控 / 依赖安全检查骨架补上 |
| 2026-03-23 | 修复 4 个工作台状态 / 下载逻辑问题：任务列表下载改成主文稿优先；`outline_ready` 不再被 cleanup 误杀；交付中刷新不再假完成；降 AI 启动失败留在第 6 步 |
| 2026-03-23 | 第一次正文生成补上强约束写作规则；只改首轮正文写作，不改后续字数矫正和引用修正 |
| 2026-03-23 | 正文交付改成正式 Word；引用核验报告改成 PDF；文档同步补上“每次改动都要同时更新文档和所有线上服务”规则 |
| 2026-03-26 | 任务列表下载按钮改成主文章优先；登录/注册客服入口接通；首页和充值页换成真实二维码；补上正式 404 页 |
| 2026-03-18 | 运营接口已联调完成；GitHub Actions 自动发布到 Railway 已接好 |
| 2026-03-18 | 降 AI 已切到 Undetectable；环境变量新增 `UNDETECTABLE_API_KEY` |
| 2026-03-18 | 修复 6 个 code review 高风险问题：RLS、原子操作、上传失败清理、交付文件失败保护 |
| 2026-03-17 | 按真实代码和线上环境重写进度表 |
| 2026-03-16 | 创建初版 PLAN.md |
