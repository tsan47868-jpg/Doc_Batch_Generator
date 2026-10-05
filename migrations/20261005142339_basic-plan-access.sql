CREATE TABLE public.user_plan_access (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL DEFAULT 'basic' CHECK (plan_id = 'basic'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_by UUID NOT NULL REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.user_plan_monthly_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,
  documents_generated INTEGER NOT NULL DEFAULT 0 CHECK (documents_generated BETWEEN 0 AND 25),
  uploads_used INTEGER NOT NULL DEFAULT 0 CHECK (uploads_used BETWEEN 0 AND 5),
  PRIMARY KEY (user_id, month_start)
);

CREATE INDEX user_plan_access_expiry_idx
  ON public.user_plan_access (status, expires_at);

ALTER TABLE public.user_plan_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_plan_monthly_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_plan_access FROM anon, authenticated;
REVOKE ALL ON public.user_plan_monthly_usage FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_basic_plan_upload_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  current_month DATE := date_trunc('month', timezone('UTC', statement_timestamp()))::date;
  used_uploads INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_plan_access
    WHERE user_id = NEW.user_id
      AND plan_id = 'basic'
      AND status = 'active'
      AND starts_at <= statement_timestamp()
      AND expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'PLAN_ACCESS_REQUIRED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_plan_monthly_usage (user_id, month_start, uploads_used)
  VALUES (NEW.user_id, current_month, 1)
  ON CONFLICT (user_id, month_start)
  DO UPDATE SET uploads_used = public.user_plan_monthly_usage.uploads_used + 1
  WHERE public.user_plan_monthly_usage.uploads_used < 5
  RETURNING uploads_used INTO used_uploads;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MONTHLY_UPLOAD_LIMIT_REACHED' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_basic_plan_document_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  current_month DATE := date_trunc('month', timezone('UTC', statement_timestamp()))::date;
  used_documents INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_plan_access
    WHERE user_id = NEW.user_id
      AND plan_id = 'basic'
      AND status = 'active'
      AND starts_at <= statement_timestamp()
      AND expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'PLAN_ACCESS_REQUIRED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_plan_monthly_usage (user_id, month_start, documents_generated)
  VALUES (NEW.user_id, current_month, 1)
  ON CONFLICT (user_id, month_start)
  DO UPDATE SET documents_generated =
    public.user_plan_monthly_usage.documents_generated + 1
  WHERE public.user_plan_monthly_usage.documents_generated < 25
  RETURNING documents_generated INTO used_documents;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MONTHLY_DOCUMENT_LIMIT_REACHED' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_basic_plan_upload_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_basic_plan_document_limit() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER chats_enforce_basic_plan_upload_limit
  BEFORE INSERT ON public.chats
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_basic_plan_upload_limit();

CREATE TRIGGER documents_enforce_basic_plan_document_limit
  BEFORE INSERT ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_basic_plan_document_limit();