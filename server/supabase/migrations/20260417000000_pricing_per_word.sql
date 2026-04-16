-- 把正文 / 降 AI / 文章修改的计费规则从「每 1000 字 X 积分（向上取整）」
-- 改成「每字 X 积分（精确按字、整体向上取整）」。
--
-- 用户已确认无在途任务，可以一次性切换：
--   * 删掉旧的 *_per_1000 配置
--   * 写入新的 *_per_word 配置（小数）
--
-- 为了和 scoring_price_per_word 现有风格保持一致，小数也写成 JSON 字符串。
-- system_config.value 是 jsonb，存字符串可以避开浮点数精度抖动。

-- 1) 删旧配置
DELETE FROM system_config WHERE key IN (
  'writing_price_per_1000',
  'humanize_price_per_1000',
  'revision_price_per_1000'
);

-- 2) 新增 per_word 配置（已存在则不动）
INSERT INTO system_config (key, value) VALUES
  ('writing_price_per_word',  '"0.1"'),
  ('humanize_price_per_word', '"0.4"'),
  ('revision_price_per_word', '"0.2"')
ON CONFLICT (key) DO NOTHING;

-- 3) scoring_price_per_word 已存在（0.1），保持不动
