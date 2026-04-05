-- 文章修改功能：revisions 表 + revision_files 表

-- 1. 创建 revisions 表
CREATE TABLE revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  instructions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  result_text TEXT,
  word_count INTEGER,
  frozen_credits INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  refunded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一时间一个用户只能有一个进行中的修改
CREATE UNIQUE INDEX idx_one_active_revision_per_user
  ON revisions (user_id) WHERE status = 'processing';

CREATE INDEX idx_revisions_user_id ON revisions (user_id);
CREATE INDEX idx_revisions_status ON revisions (status);

-- RLS
ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own revisions"
  ON revisions FOR SELECT
  USING (user_id = auth.uid());

-- 2. 创建 revision_files 表
CREATE TABLE revision_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('material', 'revision_output')),
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_revision_files_revision_id ON revision_files (revision_id);

ALTER TABLE revision_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own revision files"
  ON revision_files FOR SELECT
  USING (
    revision_id IN (SELECT id FROM revisions WHERE user_id = auth.uid())
  );

-- 3. 系统配置：修改功能单价
INSERT INTO system_config (key, value) VALUES
  ('revision_price_per_1000', '"250"')
ON CONFLICT (key) DO NOTHING;
