-- 文章修改：记录 GPT-5.4 article_detection 识别出的主文章文件名
--
-- 背景：旧版按"所有上传文件字数总和 × 单价"冻结积分，会把 6.5MB PDF 估成
-- 100 多万字、冻结 21 万积分等过冻情况，体验很差。
--
-- 新版（2026-04-18）：精准冻结公式
--   ceil(主文章字数 × 1.2) + 参考材料数 × 50 + 图片数 × 100
-- 主文章靠 GPT-5.4 article_detection stage 识别。识别结果存到这个字段，
-- executeRevision 调 Claude 时再读出来，告诉 Claude "这是主文章，那些是参考"，
-- 同时解决"Claude 不知道改哪份"的问题。
--
-- 兼容性：NOT NULL DEFAULT '{}'，旧 revisions 数据自动 backfill 成空数组。
-- executeRevision 见空数组时走旧 prompt 行为（不告诉 Claude 哪份是主文章），
-- 不破坏已落库的历史任务。

ALTER TABLE revisions
  ADD COLUMN IF NOT EXISTS main_article_filenames TEXT[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN revisions.main_article_filenames IS
  '由 GPT-5.4 article_detection stage 识别出的主文章文件名列表。executeRevision 用它告诉 Claude 改哪份。空数组 = 旧任务兼容，走旧 prompt 行为。';
