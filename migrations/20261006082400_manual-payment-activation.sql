CREATE TABLE public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('basic', 'advanced')),
  mpesa_reference TEXT NOT NULL UNIQUE
    CHECK (mpesa_reference ~ '^[A-Z0-9]{5,20}$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'code_issued', 'redeemed', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id)
);

CREATE INDEX payment_requests_status_created_idx
  ON public.payment_requests (status, created_at DESC);
CREATE INDEX payment_requests_user_created_idx
  ON public.payment_requests (user_id, created_at DESC);
CREATE UNIQUE INDEX payment_requests_one_pending_per_user_idx
  ON public.payment_requests (user_id)
  WHERE status = 'pending';

CREATE TABLE public.payment_access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE REFERENCES public.payment_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('basic', 'advanced')),
  code_hash TEXT NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ
);

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_access_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_requests, public.payment_access_codes FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_manual_plan_grant(
  target_user_id UUID,
  target_plan_id TEXT,
  target_admin_id UUID
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  current_access public.user_plan_access%ROWTYPE;
  grant_start TIMESTAMPTZ := statement_timestamp();
  grant_base TIMESTAMPTZ := statement_timestamp();
  grant_expiry TIMESTAMPTZ;
BEGIN
  IF target_plan_id NOT IN ('basic', 'advanced') THEN
    RAISE EXCEPTION 'INVALID_PLAN';
  END IF;

  PERFORM 1
  FROM auth.users
  WHERE id = target_user_id
  FOR UPDATE;

  SELECT * INTO current_access
  FROM public.user_plan_access
  WHERE user_id = target_user_id
  FOR UPDATE;

  IF FOUND
     AND current_access.status = 'active'
     AND current_access.expires_at > statement_timestamp() THEN
    grant_start := current_access.starts_at;
    grant_base := current_access.expires_at;
  END IF;

  grant_expiry := grant_base + INTERVAL '1 month';
  INSERT INTO public.user_plan_access (
    user_id, plan_id, status, starts_at, expires_at, updated_by, updated_at
  )
  VALUES (
    target_user_id, target_plan_id, 'active', grant_start, grant_expiry,
    target_admin_id, statement_timestamp()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = EXCLUDED.status,
    starts_at = EXCLUDED.starts_at,
    expires_at = EXCLUDED.expires_at,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

  RETURN grant_expiry;
END;
$$;

CREATE OR REPLACE FUNCTION public.fulfill_payment_request(
  target_request_id UUID,
  target_action TEXT,
  target_admin_id UUID,
  target_code_hash TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  payment_request public.payment_requests%ROWTYPE;
BEGIN
  IF target_action NOT IN ('grant', 'issue_code', 'reject') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_ACTION';
  END IF;

  SELECT * INTO payment_request
  FROM public.payment_requests
  WHERE id = target_request_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_REQUEST_NOT_PENDING';
  END IF;

  IF target_action = 'grant' THEN
    PERFORM public.apply_manual_plan_grant(
      payment_request.user_id, payment_request.plan_id, target_admin_id
    );
    UPDATE public.payment_requests
    SET status = 'approved',
        reviewed_at = statement_timestamp(),
        reviewed_by = target_admin_id
    WHERE id = payment_request.id;
    RETURN 'approved';
  END IF;

  IF target_action = 'issue_code' THEN
    IF target_code_hash IS NULL OR target_code_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_CODE';
    END IF;

    INSERT INTO public.payment_access_codes (
      request_id, user_id, plan_id, code_hash, created_by, expires_at
    )
    VALUES (
      payment_request.id,
      payment_request.user_id,
      payment_request.plan_id,
      target_code_hash,
      target_admin_id,
      statement_timestamp() + INTERVAL '30 days'
    );

    UPDATE public.payment_requests
    SET status = 'code_issued',
        reviewed_at = statement_timestamp(),
        reviewed_by = target_admin_id
    WHERE id = payment_request.id;
    RETURN 'code_issued';
  END IF;

  UPDATE public.payment_requests
  SET status = 'rejected',
      reviewed_at = statement_timestamp(),
      reviewed_by = target_admin_id
  WHERE id = payment_request.id;
  RETURN 'rejected';
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_payment_access_code(
  target_code_hash TEXT,
  target_user_id UUID
)
RETURNS TABLE (plan_id TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  access_code public.payment_access_codes%ROWTYPE;
  grant_expiry TIMESTAMPTZ;
BEGIN
  SELECT * INTO access_code
  FROM public.payment_access_codes
  WHERE code_hash = target_code_hash
    AND user_id = target_user_id
    AND redeemed_at IS NULL
    AND expires_at > statement_timestamp()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_CODE_INVALID_OR_EXPIRED';
  END IF;

  grant_expiry := public.apply_manual_plan_grant(
    access_code.user_id, access_code.plan_id, access_code.created_by
  );

  UPDATE public.payment_access_codes
  SET redeemed_at = statement_timestamp()
  WHERE id = access_code.id;

  UPDATE public.payment_requests
  SET status = 'redeemed'
  WHERE id = access_code.request_id
    AND status = 'code_issued';

  RETURN QUERY SELECT access_code.plan_id, grant_expiry;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_manual_plan_grant(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fulfill_payment_request(UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_payment_access_code(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
