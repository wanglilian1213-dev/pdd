-- 001_init.sql
-- 拼代代数据库初始化
-- 在 Supabase SQL Editor 中执行

-- 1. user_profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  nickname TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. wallets
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  frozen INTEGER NOT NULL DEFAULT 0 CHECK (frozen >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. credit_ledger
CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  type TEXT NOT NULL CHECK (type IN ('recharge', 'consume', 'refund')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref_type TEXT,
  ref_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. recharge_codes
CREATE TABLE IF NOT EXISTS recharge_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  denomination INTEGER NOT NULL CHECK (denomination > 0),
  status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used', 'voided')),
  used_by UUID REFERENCES user_profiles(id),
  used_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. tasks
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  title TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'uploading',
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  target_words INTEGER NOT NULL DEFAULT 1000,
  citation_style TEXT NOT NULL DEFAULT 'APA 7',
  special_requirements TEXT DEFAULT '',
  outline_edits_used INTEGER NOT NULL DEFAULT 0,
  frozen_credits INTEGER NOT NULL DEFAULT 0,
  failure_stage TEXT,
  failure_reason TEXT,
  refunded BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 硬约束：同一用户只能有一个进行中的任务
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_task_per_user
  ON tasks (user_id) WHERE status = 'processing';

-- 6. task_files
CREATE TABLE IF NOT EXISTS task_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('material', 'final_doc', 'citation_report', 'humanized_doc')),
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. outline_versions
CREATE TABLE IF NOT EXISTS outline_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  edit_instruction TEXT,
  target_words INTEGER NOT NULL DEFAULT 1000,
  citation_style TEXT NOT NULL DEFAULT 'APA 7',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. document_versions
CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  stage TEXT NOT NULL CHECK (stage IN ('draft', 'calibrated', 'verified', 'final')),
  word_count INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. humanize_jobs
CREATE TABLE IF NOT EXISTS humanize_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  input_version_id UUID NOT NULL REFERENCES document_versions(id),
  input_word_count INTEGER NOT NULL DEFAULT 0,
  frozen_credits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  failure_reason TEXT,
  refunded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- 10. task_events
CREATE TABLE IF NOT EXISTS task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  detail JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. system_config
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT DEFAULT ''
);

-- 插入默认配置
INSERT INTO system_config (key, value) VALUES
  ('writing_price_per_1000', '250'),
  ('humanize_price_per_1000', '250'),
  ('result_file_retention_days', '3'),
  ('material_retention_days', '3'),
  ('stuck_task_timeout_minutes', '30'),
  ('max_outline_edits', '4'),
  ('activation_denominations', '[1000, 3000, 10000, 20000]')
ON CONFLICT (key) DO NOTHING;

-- 索引
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_id ON credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_task_files_task_id ON task_files(task_id);
CREATE INDEX IF NOT EXISTS idx_task_files_expires_at ON task_files(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recharge_codes_code ON recharge_codes(code);
CREATE INDEX IF NOT EXISTS idx_outline_versions_task_id ON outline_versions(task_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_task_id ON document_versions(task_id);
CREATE INDEX IF NOT EXISTS idx_humanize_jobs_task_id ON humanize_jobs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);
