CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  actor_email text NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id
  ON audit_logs (actor_user_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs (action);
