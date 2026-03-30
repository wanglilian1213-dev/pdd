# 2026-03-30 正文封面页与 PDF 重排实施记录

## 这次实际落地的规则

- 课号不新增输入框，而是在第一次生成大纲时自动提取并保存到 `tasks.course_code`
- 提取失败允许留空，不阻断交付
- 最终正文封面标题固定使用任务标题
- 最终正文下载文件名固定使用任务标题，只做文件名安全清洗
- 正文 `Word` 第 1 页是封面页，只放课号和标题
- 正文从第 2 页开始
- `Reference` 必须另起一页
- 正文和参考文献统一 `Times New Roman 12`
- 保持 `1.5 倍行距`
- 多行 reference 默认合并为同一条，只有真正新的参考文献起始行才拆开
- 引用核验报告继续输出 `PDF`
- PDF 布局改成按真实内容测量高度和分页，不再依赖写死卡片高度

## 这次改动集中在哪

- `server/src/services/courseCodeService.ts`
  - 新增课号提取 helper
- `server/src/services/outlineService.ts`
  - 首次生成大纲时自动提取并保存课号
- `server/src/services/documentFormattingService.ts`
  - 正文 Word 改成封面页 + 正文页 + Reference 新页
- `server/src/services/writingService.ts`
  - 最终正文文件名改成任务标题，并把课号 / 标题交给 Word 排版
- `server/src/services/humanizeService.ts`
  - 降 AI 后文稿也复用同一套封面与分页排版
- `server/src/services/citationReportTemplateService.ts`
  - PDF 报告改成按真实文字高度排版和分页
- `server/supabase/migrations/20260330000002_tasks_course_code.sql`
  - 给 `tasks` 表新增 `course_code`

## 验证重点

- 封面页是否存在
- 正文是否从第 2 页开始
- `Reference` 是否新起一页
- 多行 reference 是否不会被拆烂
- PDF 长内容是否会跨页而不是重叠
- 线上真实交付是否仍然输出 `Word + PDF`
