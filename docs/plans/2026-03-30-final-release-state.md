# 2026-04-03 最终版发布状态

这份文件是仓库里唯一保留的实施记录，用来说明“现在真正上线给客户的这一个版本”。

## 当前线上产品是什么

拼代代现在是一套已经上线的英文写作交付系统，用户流程固定为：

1. 注册 / 登录
2. 兑换激活码拿积分
3. 上传材料创建任务
4. 系统生成首版大纲
5. 用户确认大纲
6. 系统生成正文、矫正字数、核验引用
7. 交付正式 `Word` 正文和正式 `PDF` 引用报告
8. 用户可选继续做降 AI

## 2026-04-15 文章评审功能上线

- 新增"文章评审"独立主功能，和主写作、文章修改完全并行
- 入口：
  - 侧边栏新增"文章评审"菜单（顺序：工作台 → 文章修改 → 文章评审 → 我的任务 → 账户额度），图标用 `Gauge`
  - 新增主路由 `/dashboard/scoring`（此路由经用户 2026-04-15 明示授权新增，不算违反 `CLAUDE.md` 红线 #5）
  - `/dashboard/tasks` 新增第 3 个 tab "评审记录"，与写作任务、文章修改并列
- 计费：
  - 单价 `0.1` 积分/word（由 `system_config.scoring_price_per_word` 控制，支持小数，`opsService.validateConfigValue` 已新增 `POSITIVE_NUMBER_CONFIG_KEYS` 小数校验分支）
  - "word" 定义：汉字每字 1 个 + 英文按空格切词 + 中英混合相加（不引入中文分词库）
  - 冻结按所有上传文件精确提取的 word 总和；结算按 GPT 识别为 `role=article` 的文件精确字数；差额自动退款
  - `settled_words = clamp(sum of article word_count, 0, input_word_count)`；如果 GPT 没识别到任何 article 或文件名完全对不上，fallback 到 `input_word_count` 全额结算（保守兜底）
  - 文件名匹配用宽松规则（trim + toLowerCase + 去路径前缀），避免 GPT 把 `Report.pdf` 回写成 `report.pdf` 时命中 0 条 article
- 数据库：
  - 新增 `scorings` 表（含部分唯一索引 `WHERE status='processing'`，确保同用户同时只能一个进行中评审）
  - 新增 `scoring_files` 表（区分 `category='material' | 'report'`，report 按 `result_file_retention_days` 默认 3 天过期）
  - 新增 `system_config.scoring_price_per_word = "0.1"`
  - 迁移文件：`server/supabase/migrations/20260415000000_scorings.sql`
- AI 调用：
  - 走 OpenAI Responses API + streaming，`env.openaiModel` (`gpt-5.4`)，reasoning effort `high`
  - `MainOpenAIStage` 新增 `'scoring'` 档，**绝不加入 `stagesWithWebSearch`**（评审不联网，避免用户文章数据外流）
  - 单次 20 分钟硬超时；JSON 格式校验错一次重试一次，两次都错全额退款 + `failed`
  - Prompt 硬规则：符合要求就给 75-84 分（反吹毛求疵锚点）；每处扣分必须配直接引用 + rubric/brief 条款 + 为什么是实质问题
- PDF 报告：
  - 复用现有 pdfkit 框架，Times-Roman 12pt，按真实内容自动分页
  - 只出 PDF 不出 Word；过期 3 天复用 `result_file_retention_days`
- 失败退款：
  - 所有副作用（PDF 上传、storage、DB 写入）稳定落库后才 `settleCredits`
  - 任何前置失败（扫描件 PDF、纯图片、余额不足、并发冲突、API 失败、JSON 2 次都错、PDF 上传失败）先 `refundCredits` 再标 `failed`
- Cleanup 兜底：
  - `cleanupRuntime.ts` 新增 `cleanupStuckScorings`，挂到 `CleanupDeps / runCleanupCycle`；超时（默认 45 分钟）自动 refund + `failed`
- 前端轮询：5s 首次，+3s 步进，15s 封顶；总超时 25 分钟
- 前置拒绝：
  - 扫描件 PDF（`pdf-parse` 提取结果为空或 ≥90% 私用区 Unicode）→ 上传阶段前置 400，不冻结
  - 全部是图片、没有可提取文字的文件 → 上传阶段前置 400，不冻结
  - `.doc/.rtf/.odt` 格式（和 Revision 一致）→ 前置 400
- 新依赖：`pdf-parse@^1.1.1`（纯 JS、~2MB、无原生依赖）
- 回归步骤（线上部署后必须跑）：
  1. 上传 1500 字中文 DOCX + rubric DOCX → 冻结约 150 积分 → 轮询 completed → 检查 `settled_credits <= frozen_credits` 且约等于 `scoring_word_count × 0.1` → 下载 PDF
  2. 破坏性路径：扫描件 PDF / 纯图片 / 并发提交 / 卡死任务（手改 `updated_at` 到 45 分钟前跑 cleanup）
  3. 反吹毛求疵验收（核心质量红线）：1000-1500 字合格范文不上传 rubric → 总分必须 75-84；如果 <75 说明 prompt 没压住，要先调 prompt 再正式上线
  4. 大小写匹配验证：上传 `Report_FINAL.docx`，如果 GPT 回写成 `report_final.docx` 仍能命中（已在 `computeSettledWords` 单测覆盖）
  5. 懒加载验证：`/dashboard/tasks` 默认 tab 不触发 `/api/scoring/list`；切到"评审记录"才触发；切回不重复请求

## 2026-04-12 AI 智能客服上线

- 删除第三方 BotPenguin 客服（无法访问用户数据），改为自建 AI 客服
- 后端新增 `/api/chat/message` 端点，走 GPT-5.4（已从 Claude Haiku 迁移）
- 前端新增浮动聊天气泡组件，仅登录后的 Dashboard 页面显示
- 客服能查询当前用户的任务、积分、修改记录等数据后针对性回答
- 每用户每天限 20 条消息（内存计数，不持久化）
- 聊天记录不保存（刷新即丢失）
- 原有的人工客服组件（微信二维码弹窗/面板）保留不动
- 不需要新增环境变量（客服聊天复用已有的 OPENAI_API_KEY）

## 2026-04-03 最近一次核对结果

- GitHub `main` 最近一次核对提交：`fd48f5b`
- 2026-04-03 这轮最小修补已直接发布到 Railway：
  - `app`：`e66eacb4-fa09-41fc-9664-1d80547e8845`
  - `cleanup`：`a1cd2f0c-3fc2-4693-85a0-f2dc71b82ac2`
- 已用桌面这 3 个 PDF 做过真实线上回归：
  - `Report Marking Criteria.pdf`
  - `Final Report Writing Guide.pdf`
  - `Written Project Assessment Task Information (.pdf)(1).pdf`
- 这轮回归和修补已经确认：
  - 正式题目不会再被评分标准文件名带偏
  - 大纲和正文不再写成“怎么写报告”这种元话题
  - 最终正文文件名会优先用正式题目
  - `cleanup` 服务启动命令已核对为 `npm run start:cleanup`
  - 老材料清理只会清 `completed / failed` 任务，不会删还在 `processing / outline_ready` 的任务材料
  - `/api/user/init` 已改成“档案 / 钱包缺哪补哪”，不会再把半残账号直接判成已存在
  - 已补一次性补钱包脚本：`npm run repair:wallets`

## 当前已经锁死的交付规则

- 正文交付为 `Word (.docx)`
- 第 1 页必须是封面页
- 封面只放课号和文章标题
- 正文从第 2 页开始
- `Reference` 必须另起一页
- 正文和参考文献统一 `Times New Roman 12`
- 行距固定为 `1.5 倍`
- 参考文献统一悬挂缩进
- 引用核验报告固定交付为 `PDF (.pdf)`
- 长内容 PDF 会按真实内容自动分页，不能出现文字重叠

## 当前已经锁死的任务要求规则

- 系统会先从任务要求文件里提取：
  - 目标字数
  - 引用格式
- 如果文件里没有写清楚：
  - 目标字数默认 `1000`
  - 引用格式默认 `APA 7`
- 系统会再按统一规则换算出：
  - 最少引用数量：每 `1000` 字 `5` 条，向上取整
  - 章节数量：`1000` 字 `3` 章，每多 `1000` 字加 `1` 章，向上取整
- 章节总数包含 `Introduction` 和 `Conclusion`
- 每章固定 `3-5` 条 bullet point
- 这套结果会在大纲阶段落库，后面整条链路都只认它
- 确认大纲只负责开始写正文，不再允许手改字数和引用格式
- 大纲章节数量检查必须按真实多行章节标题来数，不能先把换行抹掉再判断；否则会把正常大纲误判成章节数不够

## 当前已经锁死的引用规则

- 正文最少引用数量必须满足任务要求换算结果
- 引用必须使用 `2020` 年之后的学术论文
- 不允许把 book 当成合规引用混进去
- 正文、字数矫正、引用修正都会带着同一套引用硬规则继续写
- 引用核验报告也按同一套规则输出：
  - 要求数量
  - 实际数量
  - `2020+` 数量
  - 疑似 book 数量
  - 疑似非学术论文数量

## 当前已经锁死的标题规则

- 用户不需要额外填写正式文章题目
- 正式题目和研究问题由系统在第一次生成大纲时一起产出并锁定
- 任务要求材料决定正文主题；评分标准、rubric、写作指南只负责补充结构、写作、引用和评分要求，不能替代任务本身的主题
- 如果任务要求材料没有给唯一题目，只给了范围、方向或几个可选项，允许模型自己定一个具体题目，但这个题目必须严格落在任务要求允许的范围里，不能跑去写“怎么写报告”这种元话题
- 上传文件名只允许继续当“任务标签/默认名称”，不再直接决定最终交付题目
- 如果老任务还没有正式题目，才会临时回退到旧任务标题，并在生成封面标题和最终 Word 文件名之前先去掉真实文件后缀
- 封面标题和正文第一页第一行如果只是直引号 / 弯引号这种轻微标点差异，也必须当成同一个标题处理，不能重复印两次
- 会处理常见后缀和脏尾巴，例如：
  - `.txt`
  - `.pdf`
  - `.doc`
  - `.docx`
  - `(.pdf)(1).pdf`
- 旧任务如果已经生成过脏名字，也统一通过“只重做交付文件”的方式补救，不重跑 AI、不重复收费

## 当前已经锁死的正文清洗规则

- 第一次正文生成、字数矫正、引用修正，这 3 个整篇重写步骤都明确禁止 Markdown 样子输出
- 字数矫正只按正文主体计数，不把文章标题、`References` 标题和参考文献条目算进目标字数；文内引用仍然算正文
- 字数矫正的目标范围固定为目标字数正负 `10%`，并且这一步会把“very strict rule, must follow”明确告诉接口
- 字数矫正最多自动重试 `5` 次；如果第 `5` 次还没压进范围，当前版本继续往后走，这次不顺手改后续交付判断
- 如果大纲还是占位词或评分标准名，系统会先自动修一次，不会直接放行到正文
- 大纲生成后还会再做一次“主题有没有被评分标准 / 写作指南带偏”的复查；如果跑偏，先自动修一次，修不回来才在大纲阶段失败
- 如果第一次正文是在“请先给题目/研究问题”这种拒答，或者完全没有引用和参考文献，系统会先自动重跑一次，不会直接把坏稿往后扩
- 如果后面的字数矫正或引用修正把原本正常的文章改坏了，系统会退回最后一个正常版本继续交付
- 正文链路超时现已统一调大：正文初稿单次最多 `30` 分钟；字数矫正每次最多 `15` 分钟；引用修正每次最多 `20` 分钟；降 AI 继续按约 `10` 分钟处理；卡住任务总兜底默认 `45` 分钟
- 最终导出 Word 前，仍然会再做一次兜底，把残留的：
  - `*斜体*`
  - `**加粗**`
  - `# 标题`
  - 列表标记
  这些内容尽量转成真正的 Word 样式，而不是直接把符号原样塞进成品

## 当前线上部署落点

- GitHub：`main`
- Railway `app`
- Railway `cleanup`
- Railway `拼代代前端`

## 当前已经锁死的账号修补规则

- `/api/user/init` 必须同时检查 `user_profiles` 和 `wallets`
- 如果两边都存在：直接返回已存在
- 如果只有 `user_profiles`：只补 `wallets`
- 如果只有 `wallets`：只补 `user_profiles`
- 如果两边都不存在：按正常新账号初始化
- 一次性修旧数据统一走：
  - `npm run repair:wallets`

## 当前历史坏任务补救规则

- 如果只是文件名、封面标题、排版脏，走：
  - `npm run repair:delivery -- <taskId...>`
- 如果任务内容本身已经坏了（例如题目是评分标准名、正文在拒答、没有引用、没有参考文献，或者正文主题已经被评分标准 / 写作指南带偏），走：
  - `npm run repair:completed -- <taskId...>`

## 仓库整理规则

- 只保留主分支 `main` 作为当前最终版
- 删除不再使用的本地开发 worktree
- 删除阶段性历史计划文档，只保留这份最终发布状态文件
- 删除已经确认无人使用的死代码

## 发布时必须同时做的事

每次以后再改这个最终版，都要同时做完下面这些动作：

1. 更新 `CLAUDE.md`
2. 更新 `PLAN.md`
3. 更新 `DESIGN.md`
4. 更新这份 `docs/plans/2026-03-30-final-release-state.md`
5. 推送到 GitHub `main`
6. 更新 Railway `app`
7. 更新 Railway `cleanup`
8. 更新 Railway `拼代代前端`
9. 重新检查一次线上真实状态
