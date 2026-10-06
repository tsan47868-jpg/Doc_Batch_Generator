CREATE TABLE public.admin_password_attempts (
  ip_hash TEXT PRIMARY KEY CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  failed_attempts INTEGER NOT NULL CHECK (failed_attempts BETWEEN 1 AND 3),
  first_failed_at TIMESTAMPTZ NOT NULL,
  last_failed_at TIMESTAMPTZ NOT NULL,
  blocked_until TIMESTAMPTZ
);

ALTER TABLE public.admin_password_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_password_attempts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_admin_password_attempt(
  target_ip_hash TEXT,
  target_action TEXT
)
RETURNS TABLE (failed_attempts INTEGER, blocked_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  attempt public.admin_password_attempts%ROWTYPE;
  attempted_at TIMESTAMPTZ := statement_timestamp();
  attempt_found BOOLEAN;
BEGIN
  IF target_ip_hash !~ '^[0-9a-f]{64}$'
     OR target_action NOT IN ('status', 'failure', 'success') THEN
    RAISE EXCEPTION 'INVALID_ADMIN_PASSWORD_ATTEMPT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(target_ip_hash));

  SELECT * INTO attempt
  FROM public.admin_password_attempts
  WHERE ip_hash = target_ip_hash
  FOR UPDATE;
  attempt_found := FOUND;

  IF target_action = 'success' THEN
    DELETE FROM public.admin_password_attempts
    WHERE ip_hash = target_ip_hash;
    RETURN QUERY SELECT 0, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF attempt_found AND attempt.blocked_until > attempted_at THEN
    RETURN QUERY SELECT attempt.failed_attempts, attempt.blocked_until;
    RETURN;
  END IF;

  IF target_action = 'status' THEN
    IF attempt_found AND attempt.last_failed_at <= attempted_at - INTERVAL '15 minutes' THEN
      DELETE FROM public.admin_password_attempts
      WHERE ip_hash = target_ip_hash;
      RETURN QUERY SELECT 0, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    RETURN QUERY
      SELECT CASE WHEN attempt_found THEN attempt.failed_attempts ELSE 0 END,
             CASE WHEN attempt_found THEN attempt.blocked_until ELSE NULL::TIMESTAMPTZ END;
    RETURN;
  END IF;

  IF attempt_found AND attempt.last_failed_at > attempted_at - INTERVAL '15 minutes' THEN
    attempt.failed_attempts := attempt.failed_attempts + 1;
  ELSE
    attempt.failed_attempts := 1;
    attempt.first_failed_at := attempted_at;
  END IF;

  attempt.last_failed_at := attempted_at;
  attempt.blocked_until := CASE
    WHEN attempt.failed_attempts >= 3 THEN attempted_at + INTERVAL '24 hours'
    ELSE NULL
  END;

  INSERT INTO public.admin_password_attempts (
    ip_hash, failed_attempts, first_failed_at, last_failed_at, blocked_until
  )
  VALUES (
    target_ip_hash, attempt.failed_attempts, attempt.first_failed_at,
    attempt.last_failed_at, attempt.blocked_until
  )
  ON CONFLICT (ip_hash) DO UPDATE SET
    failed_attempts = EXCLUDED.failed_attempts,
    first_failed_at = EXCLUDED.first_failed_at,
    last_failed_at = EXCLUDED.last_failed_at,
    blocked_until = EXCLUDED.blocked_until;

  RETURN QUERY SELECT attempt.failed_attempts, attempt.blocked_until;
END;
$$;

REVOKE ALL ON FUNCTION public.record_admin_password_attempt(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;