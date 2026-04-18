-- 「检测 AI / 降 AI」独立功能：
--   - ai_detections / ai_detection_files：检测 AI 任务 + 原稿文件
--   - standalone_humanizations / standalone_humanization_files：独立降 AI 任务 + 原稿/结果文件
--
-- 两条功能线彼此独立，和现有 tasks / revisions / scorings 也互不影响。
-- 同一用户同一时间每条线各自只允许 1 个进行中任务（部分唯一索引）。
-- 状态机同 scoring：initializing → processing → completed / failed

-- ======================================================================
-- 1. ai_detections 主表（检测 AI 任务）
-- ======================================================================
CREATE TABLE ai_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  -- pdf-parse 提取的精确字数（冻结 / 结算依据）
  input_word_count INTEGER NOT NULL DEFAULT 0,
  -- ceil(input_word_count × ai_detection_price_per_word)
  frozen_credits INTEGER NOT NULL DEFAULT 0,
  -- 成功时等于 frozen_credits（字数确定，差额一般为 0）
  settled_credits INTEGER,
  -- Undetectable 综合 AI 概率 0-100（越高越像 AI）
  overall_score INTEGER,
  -- Undetectable 完整返回，含 8 家子检测器分数（result_details.scoreXxx 是"人工%"方向）
  result_json JSONB,
  status TEXT NOT NULL DEFAULT 'initializing'
    CHECK (status IN ('initializing', 'processing', 'completed', 'failed')),
  failure_reason TEXT,
  refunded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一用户同一时间只能有一个进行中的检测（initializing + processing 都算占位）
CREATE UNIQUE INDEX idx_one_active_ai_detection_per_user
  ON ai_detections (user_id) WHERE status IN ('initializing', 'processing');

CREATE INDEX idx_ai_detections_user_id ON ai_detections (user_id);
CREATE INDEX idx_ai_detections_status ON ai_detections (status);
CREATE INDEX idx_ai_detections_user_created
  ON ai_detections (user_id, created_at DESC);

ALTER TABLE ai_detections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own ai_detections"
  ON ai_detections FOR SELECT
  USING (user_id = auth.uid());

-- ======================================================================
-- 2. ai_detection_files 原稿文件表
-- ======================================================================
CREATE TABLE ai_detection_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_id UUID NOT NULL REFERENCES ai_detections(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  -- Supabase Storage 的相对路径（bucket: task-files 复用现有）
  storage_path TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT '',
  -- 后端 pdf-parse / mammoth / utf8 提取的精确字数；initializing 阶段为 NULL
  extracted_word_count INTEGER,
  -- 默认 now() + material_retention_days（清理任务按此字段过期删除原稿）
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_detection_files_detection_id
  ON ai_detection_files (detection_id);

ALTER TABLE ai_detection_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own ai_detection_files"
  ON ai_detection_files FOR SELECT
  USING (
    detection_id IN (SELECT id FROM ai_detections WHERE user_id = auth.uid())
  );

-- ======================================================================
-- 3. standalone_humanizations 主表（独立降 AI 任务）
-- ======================================================================
CREATE TABLE standalone_humanizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  -- pdf-parse 提取的原稿字数（冻结依据）
  input_word_count INTEGER NOT NULL DEFAULT 0,
  -- ceil(input_word_count × humanize_price_per_word)
  frozen_credits INTEGER NOT NULL DEFAULT 0,
  -- ceil(humanized_word_count × humanize_price_per_word)，completed 时写入
  settled_credits INTEGER,
  -- Undetectable Humanization 返回的降 AI 后正文
  humanized_text TEXT,
  humanized_word_count INTEGER,
  -- Undetectable 返回的 document id，便于排查
  undetectable_document_id TEXT,
  status TEXT NOT NULL DEFAULT 'initializing'
    CHECK (status IN ('initializing', 'processing', 'completed', 'failed')),
  failure_reason TEXT,
  refunded BOOLEAN NOT NULL DEFAULT false,
  -- 同 humanize_jobs.acknowledged 语义：false = 用户尚未确认，切回页面时恢复结果/失败提示
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_one_active_standalone_humanize_per_user
  ON standalone_humanizations (user_id)
  WHERE status IN ('initializing', 'processing');

CREATE INDEX idx_standalone_humanizations_user_id
  ON standalone_humanizations (user_id);
CREATE INDEX idx_standalone_humanizations_status
  ON standalone_humanizations (status);
CREATE INDEX idx_standalone_humanizations_user_created
  ON standalone_humanizations (user_id, created_at DESC);
-- 部分索引：切回页面时拉未确认的最新一条
CREATE INDEX idx_standalone_humanizations_unacknowledged
  ON standalone_humanizations (user_id, created_at DESC)
  WHERE acknowledged = false;

ALTER TABLE standalone_humanizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own standalone_humanizations"
  ON standalone_humanizations FOR SELECT
  USING (user_id = auth.uid());

-- ======================================================================
-- 4. standalone_humanization_files 原稿 + 结果文件表
-- ======================================================================
CREATE TABLE standalone_humanization_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  humanization_id UUID NOT NULL REFERENCES standalone_humanizations(id) ON DELETE CASCADE,
  -- 'material' = 用户上传原稿；'humanized_doc' = 降 AI 后生成的 .docx
  category TEXT NOT NULL CHECK (category IN ('material', 'humanized_doc')),
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT '',
  -- material: now() + material_retention_days; humanized_doc: now() + result_file_retention_days
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_standalone_humanization_files_humanization_id
  ON standalone_humanization_files (humanization_id);

ALTER TABLE standalone_humanization_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own standalone_humanization_files"
  ON standalone_humanization_files FOR SELECT
  USING (
    humanization_id IN (SELECT id FROM standalone_humanizations WHERE user_id = auth.uid())
  );

-- ======================================================================
-- 5. 系统配置：检测 AI 单价（0.05 积分/字）
-- 独立降 AI 继续读现有 humanize_price_per_word（0.4），不另开配置
-- ======================================================================
INSERT INTO system_config (key, value) VALUES
  ('ai_detection_price_per_word', '"0.05"')
ON CONFLICT (key) DO NOTHING;
