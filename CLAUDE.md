# 拼代代 — AI 开发规矩手册

## 项目一句话说明

拼代代是一个网页写作工具。用户上传材料，系统先出英文大纲，用户确认后再生成英文正文、做引用检查、整理交付文件，并且支持二次"降 AI"处理。

## 必读文档

开始动代码前，至少先读这 2 个文件：

- `DESIGN.md`：整体架构和分工
- `PLAN.md`：当前真实进度、下一步和已知问题

如果这次改动会碰到第三方服务接入，也先看这个文件：

- `docs/context-hub.md`：怎么查最新版第三方资料，避免按旧记忆乱写

如果本机存在这个本地私密文件，接手部署时也先看一眼：

- `docs/private/deployment-secrets.local.md`：线上项目、域名、密钥和环境信息

> **⚠️ 密钥 / 授权自取规则（硬规矩，以后所有 agent 都必须遵守）**
>
> - 所有线上服务的密钥、token、账号密码、服务 ID、项目 ID 全部写在 `docs/private/deployment-secrets.local.md`
> - 需要用到 GitHub / Railway / Supabase / 运营账号时，**自己去读这个文件**，不要来问用户要
> - 里面已经有：GitHub CLI 登录状态、Railway CLI token 路径 + 项目 ID + 服务 ID、Supabase service_role + CLI token + 项目 URL、运营账号密码
> - 本机命令行工具已经登录：`gh`（GitHub CLI）、`railway`（Railway CLI）、`curl`（可直接用 service_role 调 Supabase REST API）
> - 如果本机真的没有这个文件（新机器 / 新 agent），才来问用户要

## 当前线上情况

- Railway 项目：`glistening-achievement`
- 前端服务：`拼代代前端`
- 后端服务：`app`
- 清理服务：`cleanup`
- 前端公开域名：`https://pindaidai.uk`（自定义域名），Railway 域名：`https://pindaidai.up.railway.app`
- 后端公开域名：`https://api.pindaidai.uk`（自定义域名），Railway 域名：`https://app-production-c8a4.up.railway.app`
- 域名注册商：Cloudflare（pindaidai.uk）
- DNS 托管：Cloudflare，Zone ID: 9150e0c7de3c5dbe1dbc8ff7e7e7ff8e
- GitHub 已有自动发布工作流：
  - 推送 `main` 时自动发布后端 `app`
  - 推送 `main` 时自动发布清理服务 `cleanup`
  - 推送 `main` 时自动发布前端 `拼代代前端`
- 当前运营白名单邮箱：`1318823634@qq.com`
- 当前最新主线提交：以 GitHub `main` 上最新提交为准
- 2026-03-31 交接前已经用桌面这 3 个 PDF 做过真实线上验收：
  - `Report Marking Criteria.pdf`
  - `Final Report Writing Guide.pdf`
  - `Written Project Assessment Task Information (.pdf)(1).pdf`
- 这轮真实验收已经确认：
  - 正式题目不会再被评分标准文件名带偏
  - 大纲和正文主题会贴着真实任务要求走，不再写成"怎么写报告"
  - 最终正文下载文件名会优先使用正式题目，不再叫 `Report Marking Criteria.docx`
- 2026-04-15 新上线功能：文章评审（`/dashboard/scoring`）
  - 单价：0.1 积分/word（由 `system_config.scoring_price_per_word` 控制，可动态调整）
  - 并发规则：同一用户同一时间只能有一个 `processing` 评审（scorings 表部分唯一索引兜底）
  - 失败退款：任何失败路径（扫描件前置拒绝后的积分回退 / OpenAI 超时 / JSON 两次解析失败）都必须自动 refund

## 常用命令

### 前端

前端代码目录：`拼代代前端文件/`

```bash
cd 拼代代前端文件
npm install
npm run dev
npm run lint
npm run build
npm run start
```

### 后端

后端代码目录：`server/`

```bash
cd server
npm install
npm run dev
npm run lint
npm run build
npm run start
npm run start:cleanup
npm run repair:wallets
```

### 第三方资料查询

改 `OpenAI`、`Supabase`、`Vite`、`Express` 这类外部服务或外部库之前，先用 `Context Hub` 查最新版资料，再写代码。它只是开发时查资料用的，不是线上依赖。

```bash
# 先搜有哪些资料
npx -y @aisuite/chub search openai
npx -y @aisuite/chub search supabase

# 再拉具体文档
npx -y @aisuite/chub get openai/chat --lang js
npx -y @aisuite/chub get supabase/client --lang js

# 给资料记本机备注（只记坑和经验，不要记密钥）
npx -y @aisuite/chub annotate openai/chat "这里写项目里踩过的坑"
npx -y @aisuite/chub annotate --list
```

## 技术栈（不可擅自更换）

- 前端框架：React 19 + TypeScript
- 路由：react-router-dom v7
- 样式：Tailwind CSS v4
- UI 组件：shadcn/ui + Radix UI
- 动画：motion
- 图标：lucide-react
- 构建工具：Vite 6
- 认证：Supabase Auth
- 数据和文件：Supabase Database + Storage
- 业务接口：Railway 上的 Express 服务
- AI 调用：主写作链路走 OpenAI Responses API（统一走 `OPENAI_MODEL=gpt-5.4`）；客服聊天、降 AI 前压缩、降 AI 后格式修复、论文润色也走 OpenAI（`gpt-5.4`，reasoning effort `high`）；文章修改和图表增强走 Anthropic Claude API（`claude-opus-4-6`，开启 extended thinking）；图表后压缩走 Anthropic Claude API（`claude-sonnet-4-6`）；降 AI 走 Undetectable Humanization API（固定 `v11sr + More Human + University + Essay`）；文章评审走 OpenAI Responses API（`gpt-5.4`，reasoning effort `high`，不联网搜索），20 分钟单次超时、JSON 软约束、格式错一次重试 1 次
- 正文首轮写作规则：只在第一次正文生成时额外带上强约束写作要求（整篇一次写完、所有章节都写、只用段落、不用项目符号、强调批判性论证和具体证据）；后续字数矫正和引用修正暂时不复用这套强约束
- 图表增强规则：正文写完后的图表增强环节不再强制加图；系统会把任务特殊要求和大纲传给 AI，由 AI 根据"任务是否要求了图表、文章里有没有真实数据适合可视化、文章类型是否适合"三个维度判断；表格的门槛比图表低，有对比性内容即可加；如果判断两者都不需要，就不加任何东西，原样交付
- 图表增强 heading 保护规则（2026-04-16）：图表增强阶段 Claude 返回后除字数检查之外还要检查 heading 数量；如果 heading 数量掉到 `原始 - 1` 以下，整篇回退到原始 verified 版本（丢弃图表增强），交付带完整小标题的版本而不是残缺结构版；`postChartCondense` prompt 必须显式禁止修改 section heading
- DOI / URL 完整性规则（2026-04-16）：初稿 prompt 要求 `web_search` 没验证过的 URL / DOI 一律不写；优先 `https://doi.org/<DOI>` 规范形式；如果 DOI 也没验证过，整条 URL 字段省略；禁止猜测 / 从 pattern 反推 / 使用 tracker 或 shortener；空白 URL 优于伪造 URL
- 交付排版规则：最终正文 `Word` 必须自动套固定论文模板，第 1 页是封面（课号 + 任务标题），正文从第 2 页开始，`Reference` 必须另起一页，正文和参考文献统一 `Times New Roman 12`、`1.5 倍行距`
- 课号规则：不加新的输入框；系统在第一次生成大纲时自动从任务标题、特殊要求、材料文件里提取课号，提不出来就留空继续
- 正式题目规则：正式文章题目和研究问题必须在第一次大纲生成时一起产出并落库；后面正文生成、封面、下载文件名、核验报告标题都统一优先用这套正式题目，不再直接拿第一个上传文件名当最终交付题目
- 主题判断规则：正式题目和研究问题必须优先根据任务要求材料确定；评分标准、rubric、写作指南只负责补充结构、写作、引用和评分要求，不能抢走正文主题
- 主题判断规则：如果任务要求材料没有给唯一题目，只给了范围、方向或几个可选项，允许模型自己定一个具体题目，但这个题目必须严格符合任务要求，不能跑去写"怎么写报告"这种元话题
- 任务标题规则：如果用户没有手填标题，系统可以继续用上传文件名当"任务标签/默认名称"，但它不再决定最终交付题目
- 统一任务要求规则：系统必须先从任务要求文件里提取字数和引用格式；如果没提取到，就默认 `1000` 字和 `APA 7`
- 统一任务要求规则：最少引用数量固定按"每 1000 字 5 条、向上取整"换算；章节数量固定按"1000 字 3 章、每多 1000 字多 1 章、向上取整"，并且章节总数包含 `Introduction` 和 `Conclusion`
- 统一任务要求规则：大纲、正文、引用核验、核验报告都必须只认这一份统一任务要求结果，确认大纲这一步不再允许偷偷改字数和引用格式
- 大纲章节检查规则：章节数量必须按大纲真实多行内容来数，不能先把换行抹掉再判断；否则会把正常的 3 章大纲误判成 1 章
- 章节公式强制规则（2026-04-16）：`deriveUnifiedTaskRequirements` 默认强制用公式覆盖 GPT 返回的 `required_section_count`；只有 GPT 能从材料里 quote 到 ≥25 字、含 "section/chapter/part" 关键词的原文（`structureEvidence` 字段）时才采纳 GPT 返回的值；`trustSectionCount: true` 只在 DB 恢复 / 用户手动 override 场景显式绕过校验；禁止把公式写到大纲生成的 prompt 里让 GPT 自己算
- Draft 字数硬约束规则（2026-04-16）：`buildDraftGenerationSystemPrompt` 的字数规则是 `MUST fall between ${minWords} and ${maxWords}. Do NOT exceed`，不再用 "approximately"；若字数和深度有冲突必须优先保持 section heading / 引用数量 / 批判性论证，字数靠精简措辞而不是砍结构
- Calibration heading 保留规则（2026-04-16）：`buildWordCalibrationSystemPrompt` 接受 `draftHeadings: string[]` 参数，prompt 里明确传入原始 draft 的 heading 列表作为 ground truth（不是依赖 input 的当前 heading），每次重写都要求恢复丢失的 heading；`runWordCalibrationAttempts` 5 次全失败时按"先保 heading 数达标、再按字数距离"两段式挑最优候选，不再盲目返回最后一次
- Heading 识别正则规则（2026-04-16）：`documentFormattingService.isHeadingBlock` 必须认 "Section N: Name" / "Chapter N. Name" / "Part N: Name" 这类格式，最大长度 120 字；`extractBodyHeadingLines` 和 `countBodyHeadingLines` 是共享 util，writingService / humanizeService / 未来任何压字 / 重写环节都必须复用同一套正则
- 引用硬规则：正文和核验报告都要按统一任务要求检查引用数量、年份、类型和格式；引用必须使用 `2020` 年之后的 academic scholar paper，不允许 book
- 正文超时规则：正文初稿单次最多 `30` 分钟；字数矫正每次最多 `15` 分钟；引用修正每次最多 `20` 分钟；降 AI 继续按约 `10` 分钟处理；卡住任务的总兜底默认改成 `45` 分钟
- 降 AI 前压缩重试规则：GPT-5.4 单次压缩后检查字数，如果不在目标的 ±15% 范围内，以当前结果为输入继续压缩，最多额外重试 `3` 次；每次重试都检查引用数量，引用丢了就停止重试用上一轮结果
- 降 AI 参考文献保护规则：降 AI 只把正文部分发给 Undetectable 处理，参考文献部分（从 `References` / `Bibliography` / `Works Cited` 标题行到文末）在发送前分离保护，处理完后原样拼回；如果压缩后文本找不到参考文献标题，降级为发送全文（和旧行为一致）
- 降 AI 工作台状态恢复规则（2026-04-16）：降 AI 全程 `task.status='completed'`，只有 `task.stage` 和 `humanize_jobs.status` 在变；`getCurrentTask` 必须分三查询才能恢复——查询 1 拿 `status='processing'` 的写作中任务、查询 2 拿 `stage='humanizing'` 且 `humanize_jobs.status='processing'` 的降 AI 进行中任务（双重校验防陈年 stage 残留，双重校验失败时 fallthrough 到查询 3）、查询 3 拿用户最近一条 `status in ('completed','failed') + acknowledged=false` 的 humanize_jobs 对应 task；三查询全用 2 步走而不是 PostgREST `tasks!inner`，保持项目惯例
- 降 AI acknowledged 字段规则（2026-04-16）：`humanize_jobs.acknowledged` 默认 `false`，migration 新加字段时先用 `DEFAULT true` 把老数据 backfill 成已确认、再 `SET DEFAULT false` 让新数据未确认；用户点"完成并创建新任务"时前端 `handleNewTask` 调 `POST /api/task/:id/acknowledge-humanize` 把该 task 所有 humanize_jobs 标 `acknowledged=true`，下次切回工作台不再恢复；ack API 失败前端只 try/catch 吞掉不阻塞 reset（下次切回还会显示，用户可再 ack）；部分索引 `idx_humanize_jobs_unacknowledged (task_id, created_at DESC) WHERE acknowledged=false` 保证第三查询命中率极低时仍然瞬时返回
- 降 AI 卡死回收规则（2026-04-16）：`cleanupRuntime.cleanupStuckHumanizeJobs` 每天 3 点 + 服务启动时各跑一次，扫 `status='processing' AND created_at < now() - stuck_task_timeout_minutes`（默认 45 分钟）的 humanize_jobs；匹配到则 refund（若 `refunded=false` 且 `frozen_credits>0`）+ 标 `status=failed, failure_reason='降 AI 处理超时，积分已自动退回。', refunded=true`；若对应 task 的 stage 还是 `'humanizing'` 再重置回 `'completed'`；acknowledged 保持默认 false 让用户切回工作台能看到失败提示；`humanize_jobs` 表没有 `updated_at` 和 `user_id` 字段，所以用 `created_at` 做 cutoff、用 JOIN tasks 拿 user_id
- 降 AI 失败 UI 规则（2026-04-16）：工作台 step 7 必须有 3 分支（失败 / 处理中 / 完成），不能只 2 分支；失败分支显示红色 AlertCircle 卡 + `humanizeJob.failure_reason` 真实内容（不是 fallback 文案）+ 仍可下载原始 `final_doc` 和 `citation_report`（humanized_doc 不存在自动不显示）；`HumanizeJob` interface 和 `reshapeTaskResponse` 必须保留 `failure_reason` 字段；`workspaceStage.getWorkspaceStep` 把 `humanizeJobStatus === 'failed'` 也映射到 step 7（不能退回 step 6 显示绿色"交付完成"，跟事实矛盾）；`startHumanizePolling` 检测到 `task.status='failed'` 或 `humanizeJob.status='failed'` 都要 `setIsStartingHumanize(false)` + `clearHumanizePoll` 让 UI 立即停 spinner 进入失败态
- 文件命名规则：最终正文下载文件名固定优先用正式题目；只有老任务还没补出正式题目时，才回退到旧任务标题，并先去掉 `.txt/.pdf/.docx/.doc` 这类真实文件后缀，再做文件名安全清洗
- 标题去重规则：封面标题和正文第一页第一行如果只是直引号 / 弯引号或普通空格差异，也必须按同一个标题处理，不能在成品里重复印两次
- 正文清洗规则：第一次正文生成、字数矫正、引用修正这 3 步都要明确要求"不输出 Markdown 样子的井号、星号、下划线、反引号和列表标记"；最终导出 Word 前还要再做一次格式兜底，把残留的 md 痕迹尽量转成真正的粗体 / 斜体 / 标题段落
- 字数矫正规则：这一步只按"正文部分字数"控字，不把文章标题、`References` 标题和参考文献条目算进去；目标范围固定为目标字数的正负 `10%`
- 字数矫正规则：这一步会把"正文部分字数必须落在范围内"当成 very strict rule，最多自动重试 `5` 次；如果第 `5` 次仍然没压进范围，当前版本继续往后走，这次不顺手改别的环节
- 大纲主题复查规则：大纲生成后还要再做一次"主题有没有被评分标准 / 写作指南带偏"的复查；如果跑偏，先自动修一次，修不回来才失败在大纲阶段
- 正文修复规则：如果第一次正文出现"请先给题目/研究问题"这类拒答，或者完全没有文内引用、没有参考文献，系统不能直接把坏稿继续往下扩；必须先带上材料 + 正式题目 + 研究问题 + 大纲自动修一次，只有修完还不合格才失败退款
- 正文稳态规则：字数矫正和引用修正只能让文章更完整，不能把一个已经正常的版本改坏；如果后两步改坏了，就退回最后一个正常版本继续交付
- 旧任务补救规则：如果历史已完成任务的最终正文还带 `.txt` 尾巴或 md 痕迹，不重跑 AI，只重做交付文件；统一走 `npm run repair:delivery -- <taskId...>`
- 旧坏任务补救规则：如果历史已完成任务的标题本身是评分标准名，或者正文内容本身就是拒答 / 无引用 / 无参考文献，不能只重做文件；要统一走 `npm run repair:completed -- <taskId...>`，先修大纲和正式题目，再不重复收费地重跑正文链路
- 核验报告规则：引用核验报告继续交付 `PDF`，但必须按真实内容自动长高和分页，不能再出现文字重叠、压线、卡片高度写死的问题
- 工作台状态规则：第 6 步只是"交付阶段"，只有真正 `completed + completed` 才算交付完成；`delivering + processing` 仍然要继续轮询并显示"正在整理交付文件"
- 下载规则：任务列表里的单个"下载"按钮固定代表"下载主文稿"，优先顺序是 `humanized_doc` → `final_doc` → `citation_report`
- 文章修改规则：文章修改功能与主写作流程完全独立，走 Anthropic Claude API（`claude-opus-4-6-20250414`，开启 extended thinking），同一时间一个用户只能有一个进行中的修改请求
- 全项目计费规则（2026-04-17 改版）：所有功能统一按字精确计费，`cost = ceil(字数 × 单价)`；冻结/结算/失败退款逻辑保持不变；具体单价由 `system_config` 控制可动态调整：
  - 正文生成：`writing_price_per_word = 0.1`（确认大纲时按 `target_words` 冻结，生成完成后按冻结额结算）
  - 降 AI：`humanize_price_per_word = 0.4`（按文章字数冻结结算）
  - 文章修改：`revision_price_per_word = 0.2`（上传时按预估字数冻结，完成后按修改后实际字数结算，差额退款）
  - 文章评审：`scoring_price_per_word = 0.1`（详见下文文章评审计费规则）
  - 对外唯一展示位是 Landing 页 FAQ「各项功能是怎么收费的？」；前端 UI 不再硬编码具体单价，只显示动态预估金额
- 文章修改计费规则：每字 0.2 积分（由 `system_config.revision_price_per_word` 控制），按修改后的文章字数精确计费；失败必须自动退款
- 文章修改字数估算规则（2026-04-18）：估算分两层——
  1. **单文件原始字数**（用于前端实时累加显示参考上限）：PDF 用 pdf-parse（30 秒超时）、DOCX 用 mammoth、TXT/MD utf8、图片不计入
  2. **精准冻结字数**（真实冻结金额）：`ceil(主文章字数 × 1.2) + 参考材料数 × 50 + 图片数 × 100`
  - 主文章由 GPT-5.4 `article_detection` stage 识别；冻结积分 = `ceil(精准冻结字数 × revision_price_per_word)`
  - 旧公式（所有上传文件字数总和、PDF `file.size/6`、图片硬编码 2000 字）已彻底弃用
- 文章修改主文章识别规则（2026-04-18）：GPT-5.4 `article_detection` stage（reasoning effort `medium`，无 web_search，60s 超时，1 次重试共 2 次）。输入是每个文件的 `{filename, ext, words, rawTextSample(前 1500 字)}`，图片只传 filename。输出 JSON `{main_article_filenames, reasoning}`，硬校验 filename 必须在输入列表里防 hallucination。失败 fallback 启发式：docx 中字数最大 → 非图片中字数最大；GPT 识别 0 份时取字数最大的非图片当主文章；GPT 识别多份时全部按主文章累加。`revisions.main_article_filenames TEXT[] NOT NULL DEFAULT '{}'` 字段存识别结果。`executeRevision` 见非空数组时把「主文章 / 参考材料」分组写进 Claude prompt；见空数组（旧任务兼容）时走旧 prompt 不变。边界优化：全是图片或只有一个非图片文件时直接走启发式不调 GPT，省成本
- 文章修改前置拒绝规则（2026-04-17）：扫描件 PDF（pdf-parse 抽不出文字 / ≥90% 私用区字符 / 30 秒超时 / pdf-parse 抛错）必须在 `estimateRevisionForFile` 里返回 `isScannedPdf=true`；`POST /api/revision/estimate`、`POST /api/revision/estimate-precise`、`createRevision` 都要在余额校验之前先 400 拒绝该文件，不写库不冻结，提示用户改上传 .docx 或文字版 PDF
- 文章修改预估接口规则（2026-04-18）：
  - `POST /api/revision/estimate`（单文件，旧接口保留）：前端添加文件时累加显示原始总字数作为粗略上限
  - `POST /api/revision/estimate-precise`（多文件，新接口）：调 GPT-5.4 识别主文章 + 返回精准冻结金额 `{ mainArticleFilenames, rawTotalWords, preciseFrozenWords, preciseFrozenAmount, pricePerWord, breakdown }`，前端文件列表停止变化 1.5 秒后防抖调用
  - `createRevision` 内部独立调一次 GPT-5.4（不依赖前端 estimate-precise，避免 race / 用户改文件后未触发新预估）
  - 前端 `isInsufficient` 判定：优先 `precise.preciseFrozenAmount` → 退回单文件累加 `estimatedAmount`
- 文章修改余额前置校验规则（2026-04-17）：`createRevision` 在 INSERT revision 之前必须 `getBalance(userId)` 拿余额，不够时抛 `new InsufficientBalanceError({ required, current })` 走带数字的友好文案「需要 X 积分，您当前余额 X 积分」；竞态情况下 `freezeCredits` 抛的兜底 `InsufficientBalanceError` 仍走旧无参文案；前端 `handleSubmit` 必须先 `api.getProfile()` 拿最新余额比对再请求 createRevision
- 文章修改结算顺序规则：`settleCredits` 必须在所有副作用（Word 生成、storage 上传、`revision_files` 写入、`revisions` 状态更新）都稳定落库之后才能调用；任何在结算之后抛出的异常都会导致"失败单已收费"，因为 catch 块没法再正确退款。同理 `createRevision` 里冻结成功后的任何前置失败必须先 `refundCredits` 再处理记录，绝不允许直接删除带冻结的记录
- 文章修改卡死回收规则：`revisions` 表的 `processing` 记录由 `cleanupRuntime.cleanupStuckRevisions` 兜底，超过 `stuck_task_timeout_minutes`（默认 45 分钟）会自动 refund + 标记 failed，避免服务重启 / 进程崩溃后冻结积分永久卡住
- 文章评审规则：文章评审功能与主写作流程和文章修改流程完全独立，走 OpenAI Responses API（`gpt-5.4`，reasoning effort `high`，不联网搜索），同一时间一个用户只能有一个进行中的评审请求
- 文章评审计费规则：单价 0.1 积分/word（由 `system_config.scoring_price_per_word` 控制），汉字按字、英文按词；冻结按所有上传文件精确字数总和，结算按 GPT 识别为 `article` 文件的精确字数（`clamp(0, input_word_count)` 兜底），差额自动退款；失败必须自动退款
- 文章评审前置拒绝规则：扫描件 PDF（pdf-parse 抽文字为空或 ≥90% 私用区字符）必须在上传阶段就拒绝，不冻结；所有上传文件都是图片（没有可提取文字的文件）也在上传阶段拒绝；`.doc/.rtf/.odt` 等不支持扩展名同样拒绝
- 文章评审结算顺序规则：`settleCredits` 必须在所有副作用（PDF 生成、storage 上传、`scoring_files` 写入、`scorings` 状态更新）都稳定落库之后才能调用；任何结算之前抛出的异常必须先 `refundCredits` 再标 `failed`
- 文章评审分数锚点规则：百分制 0-100，75-84 区间代表"良好（符合要求即应落此区间）"；任何达到作业基本要求的文章不允许给出 <75 的分数；prompt 里必须明确写死五段式分数锚点（95-100/85-94/75-84/60-74/<60）和容忍度清单（少于 3 个拼写错误、语法正确的长句等不扣分）
- 文章评审 JSON 校验规则：GPT 返回的 JSON 必须通过 `parseScoringJson + validateScoringJson` 双层校验；维度权重和落在 [95, 105] 容差区间；格式错一次最多重试 1 次，两次都错则全额退款 + 标 `failed`
- 文章评审卡死回收规则：`scorings` 表的 `initializing` / `processing` 记录由 `cleanupRuntime.cleanupStuckScorings` 兜底，超过 `stuck_task_timeout_minutes`（默认 45 分钟）会自动处理。`initializing` 阶段卡死不需要 refund（未冻结），只清 Storage + 标 failed；`processing` 阶段卡死 refund + 标 failed
- 文章评审异步化规则（2026-04-16）：`POST /api/scoring/create` 只做 multer 收文件 + 快速上传 raw buffer 到 Storage + INSERT `status='initializing'` 并立即返回，**不跑 pdf-parse、不冻结积分**；后台 `prepareScoring` 做字数提取 + `freezeCredits` + UPDATE `status='processing'` + 启动 `executeScoring`；前端轮询看到 `initializing` 显示"正在验证材料"，看到 `processing` 显示"AI 评审中"。这个拆分是为了避免 HTTP 同步响应里 pdf-parse 卡死导致浏览器 "Failed to fetch"。并发锁（唯一部分索引）现在覆盖 `initializing + processing` 两个状态
- 文章评审 PDF 解析超时规则：`scoringMaterialService.extractFileText` 对 PDF 分支硬性 30 秒 timeout（pdf-parse 超时按扫描件处理，前置拒绝该文件）；pdf-parse 自己抛错（PDF 头损坏等）也按扫描件兜底处理
- 文章评审反馈语言规则（2026-04-16）：SYSTEM prompt 强制 GPT 用简体中文写 overall_comment / strengths / weaknesses / suggestions / top_suggestions，无论文章原文是什么语言；维度名字保留 rubric 原文（未上传 rubric 时用默认英文 "Content & argument" 等五维度名）；引用论文原文时放引号里保留原始语言
- 文章评审 PDF 字体规则：`scoringPdfService` 必须用 `server/fonts/SourceHanSansCN-Regular.otf`（Source Han Sans CN Regular，OFL 开源许可）渲染所有中文内容，pdfkit 内置 Times-Roman / Helvetica 不含 CJK 字形会渲染成方块；字体文件 git 追踪必须随代码一起部署
- 文章评审材料清理规则（2026-04-16 补漏）：`cleanupRuntime` 新增 `cleanupExpiredScoringMaterials`（3 天后删终态 scoring 的材料）和 `cleanupExpiredScoringReports`（按 `expires_at` 删过期 PDF 报告）；此前 `cleanupExpiredMaterials` 只扫 `task_files` 不扫 `scoring_files` 是个漏洞
- 2026-04-18 新上线功能：检测 AI / 降 AI 二合一独立页面（`/dashboard/ai-tools`）
  - 顶部 Tab 切换：[检测 AI] / [降 AI]；两条功能线独立 DB 锁、独立 pollRef，可并行运行
  - 两者都走 Undetectable.ai 官方 API，复用现有 `UNDETECTABLE_API_KEY`（不新增 env）
- 检测 AI 规则：单价 0.05 积分/字（由 `system_config.ai_detection_price_per_word` 控制）；最低 200 词、最高 30,000 词（Undetectable 硬上限）；只支持 PDF/DOCX/TXT，图片/扫描件前置拒绝
- 检测 AI API 规则：调 `POST https://ai-detect.undetectable.ai/detect` + 轮询 `POST /query`（REST，非 WebSocket）；认证用请求体 `key` 字段，不是 apikey header；返回 `result`（0-100 AI 概率，越高越 AI）+ `result_details.scoreXxx`（各子检测器的**人工编写%**，方向和 `result` 相反！前端必须换算 `100 - scoreXxx` 再画柱状图以保证方向一致）
- 检测 AI 子检测器规则：Undetectable 一次调用返回 8 家聚合分数（scoreGptZero / scoreOpenAI / scoreCopyLeaks / scoreSapling / scoreWriter / scoreContentAtScale / scoreZeroGPT / scoreCrossPlag），全部存到 `ai_detections.result_json` 永久保存；前端用纯 CSS 柱状图展示，不引入图表库
- 检测 AI 异步化规则：和 scoring 一样 `initializing → processing → completed/failed` 四态；`POST /api/ai-detection/create` 只做快速上传 + INSERT initializing + 立即返回，后台 `prepareAiDetection` 跑 pdf-parse + freezeCredits + UPDATE processing + 触发 `executeAiDetection`
- 独立降 AI 规则：单价 0.4 积分/字（复用 `humanize_price_per_word`，**不新增单价**）；最低 500 词、最高 30,000 词；只支持 PDF/DOCX/TXT；一次一份文件；复用现有 `undetectableClient.humanizeText`（v11sr + More Human + University + Essay）
- 独立降 AI 字数控制规则（2026-04-20）：执行顺序 `分离 body/reserved → 只发 body 给 Undetectable → 降 AI 后 body 字数超上限则 GPT-5.4 删减 → 拼回 reserved`；reserved 由 `standaloneHumanizeCondenseService.splitBodyAndReserved` 切分，识别中英文 `References / Reference List / Bibliography / Works Cited / Appendix(es) / 参考文献 / 附录`（标题独立成行，长度 ≤ 40 字，可带编号 Appendix A / 附录一）；目标字数以**原正文字数（去 reserved 后）**为基准 ±10%；GPT-5.4 删减 prompt 严格要求"只能整句删除、不能改任何字"并保护引用 `(Author, Year)` 和 section 标题，最多 3 次重试，全部失败时取**最接近目标中值**的那一轮（"尽力而为"）；整次 GPT 调用异常时降级交付未删减的 humanized body + reserved（不让整条任务失败，用户已付费）；**不动工作台 humanizeService**
- 独立降 AI 正文过短规则：分离后 body < 200 词（Undetectable 下限）→ 抛错走 executeStandaloneHumanize catch 全额退款 + 标 failed
- 独立降 AI 短路规则：Undetectable 返回的 humanized body 字数已在 ±10% 范围内 → 直接跳过 GPT 删减，节省 OpenAI 调用成本
- 独立降 AI 交付规则：生成的 `.docx` 用 `buildFormattedPaperDocBuffer` 简单版（paperTitle 从原稿文件名去扩展名提取、不带课号、不带封面/参考文献模板），降 AI 后的正文永久存在 `standalone_humanizations.humanized_text`
- 独立降 AI 卡死回收规则：`standalone_humanizations` 表的 `initializing` / `processing` 记录由 `cleanupRuntime.cleanupStuckStandaloneHumanizations` 兜底，45 分钟超时；`initializing` 阶段卡死只清文件不退款（未冻结），`processing` 阶段卡死 refund + 标 failed
- 独立降 AI acknowledged 规则：沿用 humanize_jobs 的 acknowledged 字段语义，`standalone_humanizations.acknowledged=false` 表示用户尚未关闭结果页；下次打开 `/dashboard/ai-tools` 会恢复显示最新一条未确认的完成/失败结果；用户点"降下一篇"时前端调 `POST /api/standalone-humanize/:id/acknowledge` 标记后就不再恢复
- AI 检测 / 独立降 AI 并发规则：每张主表各自 1 把"同用户同时 1 进行中任务"的部分唯一索引锁（覆盖 initializing + processing）；两条功能线互不干扰，也不干扰现有工作台降 AI；用户可同时有 1 个工作台降 AI + 1 个检测 AI + 1 个独立降 AI 并行
- AI 检测 / 独立降 AI 材料清理规则：`cleanupRuntime` 新增 `cleanupExpiredAiDetectionMaterials`（3 天后删终态 detection 的原稿）和 `cleanupExpiredStandaloneHumanizationFiles`（material 按 3 天 / humanized_doc 按 `expires_at` 过期）
- AI 检测 / 独立降 AI 轮询规则：检测 AI 前端初始 2s 递增 2s 到 15s 上限、总超时 15 min；独立降 AI 前端初始 5s 递增 3s 到 15s 上限、总超时 20 min；后端 cleanupRuntime 45 min 兜底
- 清理规则：`outline_ready` 代表等待用户确认大纲，不能被清理服务当成卡死任务自动失败
- 安全规则：前端 Supabase 地址和公开 key 只能从环境变量读取，不能再在源码里写真实兜底值
- 安全规则：后端跨域白名单必须走 `ALLOWED_ORIGINS`，不能再全开放
- 登录保护：前端登录有本地连错冷却；注册密码最低要求 8 位且同时包含字母和数字
- 轮询规则：大纲 / 正文 / 降 AI 轮询都要带超时和逐步放慢，不允许一直固定频率死问
- 稳定性规则：系统配置要走短时缓存；关键动作要写结构化审计记录；错误监控走可选 `SENTRY_DSN`

## 项目文件结构

```text
拼代代/
├── DESIGN.md
├── PLAN.md
├── docs/
│   ├── plans/
│   └── private/                    # 本地私密文件，不提交
├── server/
│   ├── src/
│   ├── supabase/migrations/
│   ├── package.json
│   └── .env.example
└── 拼代代前端文件/
    ├── src/
    │   ├── components/
    │   ├── contexts/
    │   ├── lib/
    │   └── pages/
    ├── package.json
    ├── server.cjs
    ├── vite.config.ts
    └── .env.example
```

## 路由表（不可擅自新增主路由）

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | Landing | 首页，引导注册登录 |
| `/login` | Login | 邮箱密码登录 |
| `/register` | Register | 注册 + 初始化 |
| `/dashboard/workspace` | Workspace | 核心工作台 |
| `/dashboard/revision` | Revision | 文章修改（上传文章 + 修改要求 → Claude 修改 → 下载） |
| `/dashboard/scoring` | Scoring | 文章评审（上传文章 / rubric / brief → GPT 模拟学术评审 → PDF 报告 + 网页展示） |
| `/dashboard/ai-tools` | AiTools | 检测 AI / 降 AI（顶部 Tab 切换）：两条独立功能线并行，检测调 Undetectable Detector 聚合 8 家分数，降 AI 复用 Undetectable Humanization 引擎 |
| `/dashboard/tasks` | Tasks | 历史任务列表 + 文章修改记录 + 评审记录 + AI 检测记录 + 独立降 AI 记录（五 tab 切换） |
| `/dashboard/recharge` | Recharge | 余额和激活码兑换 |
| `/activation-rules` | ActivationRules | 静态页 |
| `/privacy-policy` | PrivacyPolicy | 静态页 |
| `/terms-of-service` | TermsOfService | 静态页 |
| `*` | NotFound | 所有不存在地址的兜底页 |

## Claude 行为规范

1. **先解释再动手** — 碰到 bug 或需要改动时，必须先用大白话跟用户讲清楚：出了什么问题、为什么出问题、打算怎么修、有没有别的方案。要多对话、多探讨，用户确认了再动手写代码。不允许闷头直接改
2. **改完必须 push** — 代码改完、lint 和 build 通过后，必须立即 commit 并 push 到 `main`。不要等用户催，不要只 push 到 feature 分支
3. **不许删自己正在用的目录** — 清理 git worktree 或临时文件时，先 `cd` 到安全目录再删。永远不要删除自己当前所在的工作目录
4. **先读完文档再提问** — 如果答案已经写在 `CLAUDE.md`、`DESIGN.md`、`PLAN.md` 里，不要再问用户。先读完再说
5. **用大白话沟通** — 所有跟用户的对话都用中文大白话，不要用专业术语堆砌。技术细节要翻译成用户能听懂的话
6. **临时文件不许放工作目录根下** — 用 Playwright MCP 或其他 sandbox 跑测试时，临时上传文件必须放在 `.playwright-mcp/`、`/tmp/` 或 `server/.test-fixtures/` 这类已知子目录里，**禁止**在工作目录根下 `mkdir + rm` 同名子目录（如 `/Users/jeffo/Desktop/拼代代/.test-files/`）。这会触发 Claude Code sandbox 的 working directory state 失效，所有后续 Bash/Read/Glob 都会报 `Working directory ... no longer exists`，需要 `cd ~ && cd /Users/jeffo/Desktop/拼代代` 刷新 cwd 或重启会话才能恢复

## 测试

- 后端测试框架：`node:test`（Node.js 内置）+ `tsx`（TypeScript 运行器）
- 不要用 `vitest`、`jest` 或其他第三方测试框架，除非用户明确要求
- 跑测试命令：`cd server && npx tsx --test src/**/*.test.ts`

## 代码规则

1. 用 TypeScript，不回退到纯 JavaScript
2. 组件用函数式写法，不用 class 组件
3. 用户能看到的文案统一用中文
4. 前端不自己猜业务状态，真实状态以 Supabase/后端返回为准
5. 收费金额、可修改次数、有效期这些规则，不要写死在前端
6. 改完代码必须重新跑检查
7. 客服二维码、微信号、邮箱统一从一处读取，不要在多个页面各写各的
8. 前端和后端的环境变量都必须有 `.env.example`，并保持和真实代码读取项一致

## 红线

1. 不能自建第二套登录系统，只认 Supabase Auth
2. 不能让注册成功但初始化失败的用户进入工作台
3. 不能在收费阶段失败后不退款
4. 不能为了图快，在公开仓库里写入密钥明文
5. 不能推翻现有页面结构和主路由
   - 例外：`/dashboard/scoring` 为 2026-04-15 用户明示授权新增的"文章评审"独立主路由，不算违反红线 #5
   - 例外：`/dashboard/ai-tools` 为 2026-04-18 用户明示授权新增的"检测 AI / 降 AI"独立主路由，不算违反红线 #5

## 改代码前先检查

1. 这个改动是不是和 `PLAN.md` 当前任务一致
2. 这个改动是不是符合 `DESIGN.md` 的分层
3. 这个改动涉及的业务规则，在 `DESIGN.md` 或 `PLAN.md` 里怎么写
4. 有没有影响线上 Railway 和 Supabase 配置
5. 如果动到第三方 SDK 或接口，先查 `docs/context-hub.md` 和 Context Hub 当前资料

## 完成后必须做

1. 跑 `npm run lint`
2. 跑 `npm run build`
3. 如果动了业务流程、部署方式、页面入口或真实进度，同步更新文档
4. 每次改动后，都要一起检查并同步这些本地项目文件，避免实际进度和说明打架：
   - `PLAN.md`
   - `DESIGN.md`
   - `docs/plans/2026-03-30-final-release-state.md`
5. 每次确认改动通过后，都要把线上服务一起更新到最新，不允许只更一部分：
   - GitHub `main`
   - Railway `app`
   - Railway `cleanup`
   - Railway `拼代代前端`
6. 发布完成后，要再检查一遍线上状态，确认不是"代码推了，但真实线上还是旧版本"
7. 如果这次改动动到了安全边界、缓存、审计、监控、跨域或轮询策略，必须在文档里写明白默认值和边界
