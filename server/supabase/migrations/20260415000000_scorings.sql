-- 文章打分评审功能：scorings 表 + scoring_files 表 + 系统配置
-- 独立于主写作和文章修改两条链路，三者可以并行；同一用户同一时间只允许一个评审 processing。

-- 1. 创建 scorings 表
CREATE TABLE scorings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  -- 所有上传文件精确提取的 word 总和（冻结依据）
  input_word_count INTEGER NOT NULL DEFAULT 0,
  -- GPT 识别为 article 的文件的 word 数（结算依据）。仅 completed 时写入。
  scoring_word_count INTEGER,
  frozen_credits INTEGER NOT NULL DEFAULT 0,
  settled_credits INTEGER,
  -- 评分场景：'rubric' | 'brief_only' | 'article_only'
  scenario TEXT,
  -- GPT 返回的完整 JSON（用于前端详情页渲染和审计）
  result_json JSONB,
  -- GPT 给的总分，0-100。便于列表页直接 order by / 过滤。
  overall_score INTEGER,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  failure_reason TEXT,
  refunded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一时间一个用户只能有一个进行中的评审（三条 AI 功能线各自独立防重）
CREATE UNIQUE INDEX idx_one_active_scoring_per_user
  ON scorings (user_id) WHERE status = 'processing';

CREATE INDEX idx_scorings_user_id ON scorings (user_id);
CREATE INDEX idx_scorings_status ON scorings (status);

-- RLS
ALTER TABLE scorings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own scorings"
  ON scorings FOR SELECT
  USING (user_id = auth.uid());

-- 2. 创建 scoring_files 表
CREATE TABLE scoring_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scoring_id UUID NOT NULL REFERENCES scorings(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('material', 'report')),
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT '',
  -- 后端按文件名关键词预判的角色
  hinted_role TEXT CHECK (hinted_role IN ('article', 'rubric', 'brief', 'unknown')),
  -- GPT 读完内容后最终裁决的角色
  detected_role TEXT CHECK (detected_role IN ('article', 'rubric', 'brief', 'other')),
  -- 服务端 mammoth / pdf-parse / 直接 utf8 提取得到的精确 word 数
  extracted_word_count INTEGER,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scoring_files_scoring_id ON scoring_files (scoring_id);

ALTER TABLE scoring_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own scoring files"
  ON scoring_files FOR SELECT
  USING (
    scoring_id IN (SELECT id FROM scorings WHERE user_id = auth.uid())
  );

-- 3. 系统配置：评审单价（0.1 积分/word）
-- 注意：这是项目里第一个小数配置项，opsService.validateConfigValue 需要同步加小数分支。
INSERT INTO system_config (key, value) VALUES
  ('scoring_price_per_word', '"0.1"')
ON CONFLICT (key) DO NOTHING;
