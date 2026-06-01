# 拼代代设计蓝图

## 产品定位

拼代代是一个网页写作交付系统。用户上传材料后，系统先生成英文大纲，用户确认后再生成正文、核验引用、整理交付文件，并支持文章修改、文章评审、AI 检测和降 AI。

核心要求只有三件事：

- 交付质量稳定：正文结构、字数、引用、文件格式都要可控
- 钱和状态可靠：冻结、扣费、退款、任务进度都只能以后端和数据库为准
- 失败有兜底：失败要给原因，收费阶段失败要自动退款，卡住任务要自动回收

## 当前线上架构

```text
用户网页
  ↓
Railway 前端服务：拼代代前端
  ↓
Railway 后端服务：app
  ↓
Supabase：登录、数据库、文件存储

Railway 清理服务：cleanup
  ↘ 定时处理卡住任务、过期文件、StealthWriter 会话健康检查

Railway StealthWriter worker 服务（待新增）
  ↘ 维护第三方登录会话；新增后给 app / cleanup 补齐连接变量
```

## 线上服务

- GitHub 仓库：`wanglilian1213-dev/pdd`
- Railway 项目：当前显示名 `PDD`（旧文档名 `glistening-achievement`）
- Railway 当前已有服务：`拼代代前端`、`app`、`cleanup`
- 前端域名：`https://pindaidai.uk`
- 后端域名：`https://api.pindaidai.uk`
- 数据库和文件：Supabase
- AI 写作主模型：`gpt-5.5`
- AI 检测 / 降 AI：本地待发布代码已切到 StealthWriter；线上完整接通前要先核对当前部署版本
- StealthWriter worker：代码已加入；正确落点是在同一个 Railway 项目里新增单独服务，不使用其他旧云服务器。当前 Railway 服务清单里还没有这个 worker，新增后 `app` / `cleanup` 还需要补齐连接变量

敏感信息只放环境变量或本机私密文档，不写进公开仓库。

## 功能流程

### 主写作

1. 用户注册或登录
2. Supabase 负责账号登录
3. Railway 后端初始化用户档案和钱包
4. 用户上传任务材料
5. 系统生成大纲，用户可以修改
6. 用户确认大纲后冻结积分
7. 后端生成正文、校正字数、核验引用、生成交付文件
8. 成功后扣费，失败后退款
9. 用户下载 Word 正文和 PDF 引用报告
10. 用户可继续发起工作台降 AI

### 文章修改

用户上传已有文章和修改要求。系统识别主文章，按主文章和参考材料估算冻结积分，完成后按实际修改结果结算，失败自动退款。

### 文章评审

用户上传文章，也可以上传评分标准或作业说明。后端先快速建单进入“验证材料”，后台解析文件、冻结积分，再调用模型生成中文评审结果和 PDF 报告。`initializing` 和 `processing` 都算进行中，防止用户重复提交。

### AI 检测 / 独立降 AI

AI 检测和独立降 AI 的待发布版本都走 StealthWriter。检测结果用“越高越像人写”的分数口径展示；独立降 AI 会尝试循环优化，保存最终分数、逐句结果和交付文件。失败时按冻结情况退款。线上 worker 服务和连接变量未补齐前，不能把 worker 链路当作已经完整上线。

## 数据真相

数据真相只认 Supabase。前端只展示，不自己判断收费和任务状态。

核心表：

- `user_profiles`：用户档案
- `wallets`：余额
- `credit_ledger`：积分流水
- `recharge_codes`：激活码
- `tasks` / `task_files`：主写作任务和文件
- `humanize_jobs`：工作台降 AI
- `revisions` / `revision_files`：文章修改
- `scorings` / `scoring_files`：文章评审
- `ai_detections` / `ai_detection_files`：AI 检测
- `standalone_humanizations` / `standalone_humanization_files`：独立降 AI
- `stealthwriter_session`：StealthWriter 会话
- `system_config`：价格、清理天数、卡住任务阈值等配置
- `audit_logs`：关键动作记录

## 文件规则

所有用户上传材料和系统生成文件都放在 Supabase Storage。

- 主写作交付：Word 正文 + PDF 引用报告
- 工作台降 AI：复用正式论文排版
- 文章评审：中文 PDF 报告
- 独立降 AI：纯正文 Word，不带课程编号、封面、参考文献模板
- 任务列表单个下载按钮优先下载主文稿：降 AI 版 → 最终正文 → 引用报告
- 过期材料和报告由 cleanup 清理

## 收费规则

所有收费功能都按字数计算，价格从 `system_config` 读取：

- 正文生成：`writing_price_per_word`
- 工作台降 AI / 独立降 AI：`humanize_price_per_word`
- 文章修改：`revision_price_per_word`
- 文章评审：`scoring_price_per_word`
- AI 检测：`ai_detection_price_per_word`

收费流程固定为：先冻结，成功后结算，失败后退款。不能在交付文件和数据库记录没写稳之前先扣费。

## 开发红线

- 不能自建第二套登录系统，只认 Supabase Auth
- 不能让前端自己算钱、自己决定任务状态
- 不能收费失败后不退款
- 不能把密钥写进仓库
- 不能把 `outline_ready` 这种等用户操作的状态当作卡死任务清理
- 不能只改线上变量，不确认线上代码是否支持
- 不能只看“提交成功”，必须验到结果页或最终文件

## 文档约定

- `agent.md` 写开发助手规矩和项目红线
- `PLAN.md` 写当前进度和剩余问题
- `tasks/todo.md` 写近期执行清单和验收结果
- `tasks/lessons.md` 写被纠正后的经验
- 历史 PRD 和旧实施记录不再作为当前事实来源
