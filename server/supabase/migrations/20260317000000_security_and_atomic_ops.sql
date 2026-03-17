-- 安全与原子操作修复
-- 1. 为公开表开启 RLS，避免 anon/authenticated 直接读全部数据
-- 2. 把余额、激活码、确认大纲、启动降 AI 这些高风险操作收进数据库函数里，一次做完

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE outline_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE humanize_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recharge_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_select_own ON user_profiles;
CREATE POLICY user_profiles_select_own
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS wallets_select_own ON wallets;
CREATE POLICY wallets_select_own
  ON wallets
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS credit_ledger_select_own ON credit_ledger;
CREATE POLICY credit_ledger_select_own
  ON credit_ledger
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS tasks_select_own ON tasks;
CREATE POLICY tasks_select_own
  ON tasks
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS task_files_select_own ON task_files;
CREATE POLICY task_files_select_own
  ON task_files
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tasks
      WHERE tasks.id = task_files.task_id
        AND tasks.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS outline_versions_select_own ON outline_versions;
CREATE POLICY outline_versions_select_own
  ON outline_versions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tasks
      WHERE tasks.id = outline_versions.task_id
        AND tasks.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS document_versions_select_own ON document_versions;
CREATE POLICY document_versions_select_own
  ON document_versions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tasks
      WHERE tasks.id = document_versions.task_id
        AND tasks.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS humanize_jobs_select_own ON humanize_jobs;
CREATE POLICY humanize_jobs_select_own
  ON humanize_jobs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tasks
      WHERE tasks.id = humanize_jobs.task_id
        AND tasks.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS task_events_select_own ON task_events;
CREATE POLICY task_events_select_own
  ON task_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tasks
      WHERE tasks.id = task_events.task_id
        AND tasks.user_id = auth.uid()
    )
  );

-- recharge_codes 和 system_config 故意不加公开读取策略：
-- 前者是运营资产，后者是后台配置，只允许 service_role 通过后端访问。

-- ---------------------------------------------------------------------------
-- Concurrency guard
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_processing_humanize_job_per_task
  ON humanize_jobs (task_id)
  WHERE status = 'processing';

-- ---------------------------------------------------------------------------
-- Atomic wallet helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION wallet_credit_balance(
  p_user_id UUID,
  p_amount INTEGER,
  p_type TEXT,
  p_ref_type TEXT,
  p_ref_id UUID,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet wallets%ROWTYPE;
  v_new_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  IF p_type NOT IN ('recharge', 'refund') THEN
    RAISE EXCEPTION 'INVALID_LEDGER_TYPE';
  END IF;

  SELECT *
    INTO v_wallet
    FROM wallets
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  v_new_balance := v_wallet.balance + p_amount;

  UPDATE wallets
     SET balance = v_new_balance,
         updated_at = NOW()
   WHERE user_id = p_user_id;

  INSERT INTO credit_ledger (
    user_id,
    type,
    amount,
    balance_after,
    ref_type,
    ref_id,
    note
  ) VALUES (
    p_user_id,
    p_type,
    p_amount,
    v_new_balance,
    p_ref_type,
    p_ref_id,
    p_note
  );

  RETURN jsonb_build_object(
    'balance', v_new_balance,
    'frozen', v_wallet.frozen
  );
END;
$$;

CREATE OR REPLACE FUNCTION wallet_freeze_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_ref_type TEXT,
  p_ref_id UUID,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet wallets%ROWTYPE;
  v_new_balance INTEGER;
  v_new_frozen INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT *
    INTO v_wallet
    FROM wallets
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  IF v_wallet.balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  v_new_balance := v_wallet.balance - p_amount;
  v_new_frozen := v_wallet.frozen + p_amount;

  UPDATE wallets
     SET balance = v_new_balance,
         frozen = v_new_frozen,
         updated_at = NOW()
   WHERE user_id = p_user_id;

  INSERT INTO credit_ledger (
    user_id,
    type,
    amount,
    balance_after,
    ref_type,
    ref_id,
    note
  ) VALUES (
    p_user_id,
    'consume',
    -p_amount,
    v_new_balance,
    p_ref_type,
    p_ref_id,
    p_note
  );

  RETURN jsonb_build_object(
    'balance', v_new_balance,
    'frozen', v_new_frozen
  );
END;
$$;

CREATE OR REPLACE FUNCTION wallet_settle_credits(
  p_user_id UUID,
  p_amount INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet wallets%ROWTYPE;
  v_new_frozen INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT *
    INTO v_wallet
    FROM wallets
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  IF v_wallet.frozen < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FROZEN_BALANCE';
  END IF;

  v_new_frozen := v_wallet.frozen - p_amount;

  UPDATE wallets
     SET frozen = v_new_frozen,
         updated_at = NOW()
   WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'balance', v_wallet.balance,
    'frozen', v_new_frozen
  );
END;
$$;

CREATE OR REPLACE FUNCTION wallet_refund_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_ref_type TEXT,
  p_ref_id UUID,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet wallets%ROWTYPE;
  v_new_balance INTEGER;
  v_new_frozen INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT *
    INTO v_wallet
    FROM wallets
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  IF v_wallet.frozen < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FROZEN_BALANCE';
  END IF;

  v_new_balance := v_wallet.balance + p_amount;
  v_new_frozen := v_wallet.frozen - p_amount;

  UPDATE wallets
     SET balance = v_new_balance,
         frozen = v_new_frozen,
         updated_at = NOW()
   WHERE user_id = p_user_id;

  INSERT INTO credit_ledger (
    user_id,
    type,
    amount,
    balance_after,
    ref_type,
    ref_id,
    note
  ) VALUES (
    p_user_id,
    'refund',
    p_amount,
    v_new_balance,
    p_ref_type,
    p_ref_id,
    p_note
  );

  RETURN jsonb_build_object(
    'balance', v_new_balance,
    'frozen', v_new_frozen
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic business operations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION redeem_recharge_code(
  p_user_id UUID,
  p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code recharge_codes%ROWTYPE;
  v_wallet wallets%ROWTYPE;
  v_new_balance INTEGER;
BEGIN
  SELECT *
    INTO v_code
    FROM recharge_codes
   WHERE code = TRIM(p_code)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_RECHARGE_CODE';
  END IF;

  IF v_code.status = 'used' THEN
    RAISE EXCEPTION 'RECHARGE_CODE_ALREADY_USED';
  END IF;

  IF v_code.status = 'voided' THEN
    RAISE EXCEPTION 'RECHARGE_CODE_VOIDED';
  END IF;

  SELECT *
    INTO v_wallet
    FROM wallets
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  v_new_balance := v_wallet.balance + v_code.denomination;

  UPDATE recharge_codes
     SET status = 'used',
         used_by = p_user_id,
         used_at = NOW()
   WHERE id = v_code.id;

  UPDATE wallets
     SET balance = v_new_balance,
         updated_at = NOW()
   WHERE user_id = p_user_id;

  INSERT INTO credit_ledger (
    user_id,
    type,
    amount,
    balance_after,
    ref_type,
    ref_id,
    note
  ) VALUES (
    p_user_id,
    'recharge',
    v_code.denomination,
    v_new_balance,
    'recharge_code',
    v_code.id,
    FORMAT('兑换激活码 %s 积分', v_code.denomination)
  );

  RETURN jsonb_build_object(
    'denomination', v_code.denomination,
    'balance', v_new_balance
  );
END;
$$;

CREATE OR REPLACE FUNCTION confirm_outline_task(
  p_task_id UUID,
  p_user_id UUID,
  p_target_words INTEGER,
  p_citation_style TEXT,
  p_cost INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_wallet wallets%ROWTYPE;
  v_new_balance INTEGER;
  v_new_frozen INTEGER;
BEGIN
  SELECT *
    INTO v_task
    FROM tasks
   WHERE id = p_task_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN';
  END IF;

  IF v_task.status <> 'processing' OR v_task.stage <> 'outline_ready' THEN
    RAISE EXCEPTION 'TASK_NOT_READY';
  END IF;

  SELECT *
    INTO v_wallet
    FROM wallets
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  IF v_wallet.balance < p_cost THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  v_new_balance := v_wallet.balance - p_cost;
  v_new_frozen := v_wallet.frozen + p_cost;

  UPDATE wallets
     SET balance = v_new_balance,
         frozen = v_new_frozen,
         updated_at = NOW()
   WHERE user_id = p_user_id;

  INSERT INTO credit_ledger (
    user_id,
    type,
    amount,
    balance_after,
    ref_type,
    ref_id,
    note
  ) VALUES (
    p_user_id,
    'consume',
    -p_cost,
    v_new_balance,
    'task',
    p_task_id,
    FORMAT('正文生成：%s 词，%s 积分', p_target_words, p_cost)
  );

  UPDATE tasks
     SET stage = 'writing',
         target_words = p_target_words,
         citation_style = p_citation_style,
         frozen_credits = p_cost,
         updated_at = NOW()
   WHERE id = p_task_id;

  INSERT INTO task_events (
    task_id,
    event_type,
    detail
  ) VALUES (
    p_task_id,
    'outline_confirmed',
    jsonb_build_object(
      'target_words', p_target_words,
      'citation_style', p_citation_style,
      'frozen_credits', p_cost
    )
  );

  RETURN jsonb_build_object(
    'taskId', p_task_id,
    'stage', 'writing',
    'frozenCredits', p_cost
  );
END;
$$;

CREATE OR REPLACE FUNCTION start_humanize_job(
  p_task_id UUID,
  p_user_id UUID,
  p_input_version_id UUID,
  p_input_word_count INTEGER,
  p_cost INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_wallet wallets%ROWTYPE;
  v_existing_job UUID;
  v_new_balance INTEGER;
  v_new_frozen INTEGER;
  v_job_id UUID := gen_random_uuid();
BEGIN
  SELECT *
    INTO v_task
    FROM tasks
   WHERE id = p_task_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN';
  END IF;

  IF v_task.status <> 'completed' THEN
    RAISE EXCEPTION 'HUMANIZE_TASK_NOT_COMPLETED';
  END IF;

  SELECT id
    INTO v_existing_job
    FROM humanize_jobs
   WHERE task_id = p_task_id
     AND status = 'processing'
   LIMIT 1
   FOR UPDATE;

  IF v_existing_job IS NOT NULL THEN
    RAISE EXCEPTION 'HUMANIZE_ALREADY_PROCESSING';
  END IF;

  PERFORM 1
    FROM document_versions
   WHERE id = p_input_version_id
     AND task_id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INPUT_VERSION_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_wallet
    FROM wallets
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  IF v_wallet.balance < p_cost THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  v_new_balance := v_wallet.balance - p_cost;
  v_new_frozen := v_wallet.frozen + p_cost;

  UPDATE wallets
     SET balance = v_new_balance,
         frozen = v_new_frozen,
         updated_at = NOW()
   WHERE user_id = p_user_id;

  INSERT INTO humanize_jobs (
    id,
    task_id,
    input_version_id,
    input_word_count,
    frozen_credits,
    status
  ) VALUES (
    v_job_id,
    p_task_id,
    p_input_version_id,
    p_input_word_count,
    p_cost,
    'processing'
  );

  INSERT INTO credit_ledger (
    user_id,
    type,
    amount,
    balance_after,
    ref_type,
    ref_id,
    note
  ) VALUES (
    p_user_id,
    'consume',
    -p_cost,
    v_new_balance,
    'humanize_job',
    v_job_id,
    FORMAT('降 AI：%s 词，%s 积分', p_input_word_count, p_cost)
  );

  UPDATE tasks
     SET stage = 'humanizing',
         updated_at = NOW()
   WHERE id = p_task_id;

  RETURN jsonb_build_object(
    'jobId', v_job_id,
    'stage', 'humanizing',
    'frozenCredits', p_cost
  );
END;
$$;
