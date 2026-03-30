# 2026-03-30 `.txt` 标题污染与 md 文本泄漏修复记录

## 这次为什么要修

线上最终交付的 Word 出现了两类明显脏结果：

1. 封面标题和下载文件名把上传材料原始文件名的 `.txt` 直接带到了成品里
2. 正文和参考文献里残留了 `*斜体*`、`**加粗**`、`# 标题` 这类 Markdown 样子文本，没有真正转成 Word 排版

这两个问题本质上都是“内容生成”和“最终交付整理”之间的边界没收死：

- 标题没有单独输入框，系统默认拿上传文件名顶上，但没有先去掉真实文件后缀
- 写正文时没有把“不要输出 md 样子”说死
- 最终导出 Word 时也没有把残留的 md 痕迹认真转换成真正的 Word 样式

## 这次锁定的实现方式

- 不新增标题输入框
- 默认标题继续沿用上传文件名，但必须先去掉 `.txt/.pdf/.docx/.doc`
- 这条规则既覆盖新任务创建，也覆盖旧任务重新导出
- 不只靠接口自觉不吐 md，而是两层一起做：
  - 正文生成 / 字数矫正 / 引用修正三步统一禁止 Markdown 样子输出
  - 最终导出 Word 前，再把残留 md 痕迹转成真正的粗体 / 斜体 / 标题段落
- 不重跑 AI，不重新收费；旧任务通过“只重做交付文件”的方式补救

## 实际改动

### 标题清洗

- 新增 `server/src/services/paperTitleService.ts`
- 默认标题规则统一收口到：
  - `deriveTaskTitle()`
  - `normalizeDeliveryPaperTitle()`
  - `buildDocxFileName()`
- `server/src/routes/task.ts` 创建任务时，如果标题来自上传文件名，会先去真实文件后缀再存任务标题
- `server/src/services/writingService.ts`
  - 最终正文导出时，封面标题和 `.docx` 文件名统一走清洗后的标题
- `server/src/services/humanizeService.ts`
  - 降 AI 后导出的封面标题也统一走清洗后的标题
- `server/src/services/documentFormattingService.ts`
  - 最底层 Word 排版 helper 也再兜一层，防止未来有别的调用绕过上层清洗

### md 文本清洗与转换

- `server/src/services/writingService.ts`
  - 第一次正文生成
  - 字数矫正
  - 引用修正
  这 3 步都明确要求不要输出 Markdown 样子文本
- `server/src/services/documentFormattingService.ts`
  - Word 段落不再只是整段纯文字
  - 现在会拆成可混排的小片段，支持：
    - 普通文字
    - 真斜体
    - 真加粗
  - `*italic*` / `_italic_` -> 真斜体
  - `**bold**` / `__bold__` -> 真加粗
  - `# Heading` / `## Heading` -> 真标题段落
  - 长 reference 内部换行会并回同一条，不再误拆

### 旧任务补救

- 新增 `server/src/services/deliveryRepairService.ts`
- 新增 `server/src/scripts/repairDeliveryFiles.ts`
- 新增命令：

```bash
cd server
npm run repair:delivery -- <taskId...>
```

这条命令只会：

- 读取已经保存好的最终正文和已有交付文件
- 重新生成最终 Word / 引用报告 PDF / 已存在的降 AI Word
- 套用新的标题规则和新的 Word 排版规则

不会：

- 重跑 AI
- 重新扣费
- 重走整条任务流程

## 验收重点

- `Essay Topic.txt` 不会再变成 `Essay Topic.txt.docx`
- 封面标题里不再带 `.txt`
- 正文和参考文献里不再原样残留 md 符号
- 该斜体的地方是真斜体，不是简单把星号删掉
- 旧任务可以通过 `repair:delivery` 重新生成干净成品
