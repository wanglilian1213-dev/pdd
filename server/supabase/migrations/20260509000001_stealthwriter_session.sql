CREATE TABLE IF NOT EXISTS stealthwriter_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token TEXT,
  cookie_header TEXT NOT NULL DEFAULT '',
  fp TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_refreshed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'refreshing', 'broken')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_stealthwriter_session
  ON stealthwriter_session ((status))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_stealthwriter_session_status
  ON stealthwriter_session (status, created_at DESC);

ALTER TABLE stealthwriter_session ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION replace_stealthwriter_session(
  p_session_token TEXT,
  p_cookie_header TEXT,
  p_fp TEXT,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS stealthwriter_session
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row stealthwriter_session;
BEGIN
  UPDATE stealthwriter_session
     SET status = CASE WHEN status = 'active' THEN 'expired' ELSE status END,
         updated_at = NOW()
   WHERE status = 'active';

  INSERT INTO stealthwriter_session (
    session_token,
    cookie_header,
    fp,
    expires_at,
    last_verified_at,
    last_refreshed_at,
    status,
    notes,
    created_at,
    updated_at
  ) VALUES (
    p_session_token,
    COALESCE(p_cookie_header, ''),
    COALESCE(p_fp, ''),
    p_expires_at,
    NOW(),
    NOW(),
    'active',
    p_notes,
    NOW(),
    NOW()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
