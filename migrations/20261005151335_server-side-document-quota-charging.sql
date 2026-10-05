ALTER TABLE public.plan_document_charges
  ADD COLUMN title TEXT NOT NULL DEFAULT '',
  ADD COLUMN description TEXT NOT NULL DEFAULT '';

UPDATE public.plan_document_charges charge
SET title = document.title,
    description = document.description
FROM public.documents document
WHERE document.user_id = charge.user_id
  AND document.chat_id = charge.chat_id
  AND document.doc_index = charge.doc_index;

ALTER TABLE public.plan_document_charges
  ALTER COLUMN title DROP DEFAULT,
  ALTER COLUMN description DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.charge_plan_document(
  target_user UUID,
  target_chat UUID,
  target_index INTEGER,
  target_title TEXT,
  target_description TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  active_plan TEXT;
  document_limit INTEGER;
  charged_title TEXT;
  charged_description TEXT;
BEGIN
  IF target_index NOT BETWEEN 0 AND 9
    OR char_length(trim(target_title)) NOT BETWEEN 1 AND 200
    OR char_length(target_description) > 2000
  THEN
    RAISE EXCEPTION 'INVALID_DOCUMENT_SLOT' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.chats
    WHERE id = target_chat AND user_id = target_user
  ) THEN
    RAISE EXCEPTION 'GENERATION_CHAT_NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  SELECT plan_id INTO active_plan
  FROM public.user_plan_access
  WHERE user_id = target_user
    AND status = 'active'
    AND starts_at <= statement_timestamp()
    AND expires_at > statement_timestamp()
  FOR UPDATE;

  IF active_plan IS NULL THEN
    RAISE EXCEPTION 'PLAN_ACCESS_REQUIRED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.plan_document_charges (
    user_id, month_start, chat_id, doc_index, title, description
  )
  VALUES (
    target_user,
    date_trunc('month', timezone('UTC', statement_timestamp()))::date,
    target_chat,
    target_index,
    trim(target_title),
    target_description
  )
  ON CONFLICT DO NOTHING;

  IF NOT FOUND THEN
    SELECT title, description
    INTO charged_title, charged_description
    FROM public.plan_document_charges
    WHERE user_id = target_user
      AND month_start = date_trunc('month', timezone('UTC', statement_timestamp()))::date
      AND chat_id = target_chat
      AND doc_index = target_index;

    IF charged_title IS DISTINCT FROM trim(target_title)
      OR charged_description IS DISTINCT FROM target_description
    THEN
      RAISE EXCEPTION 'DOCUMENT_SLOT_ALREADY_CHARGED' USING ERRCODE = '23505';
    END IF;

    RETURN TRUE;
  END IF;

  document_limit := CASE active_plan WHEN 'advanced' THEN 50 ELSE 25 END;

  INSERT INTO public.user_plan_monthly_usage (user_id, month_start, documents_generated)
  VALUES (
    target_user,
    date_trunc('month', timezone('UTC', statement_timestamp()))::date,
    1
  )
  ON CONFLICT (user_id, month_start)
  DO UPDATE SET documents_generated =
    public.user_plan_monthly_usage.documents_generated + 1
  WHERE public.user_plan_monthly_usage.documents_generated < document_limit;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MONTHLY_DOCUMENT_LIMIT_REACHED' USING ERRCODE = '23514';
  END IF;

  RETURN TRUE;
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
  active_plan TEXT;
  document_limit INTEGER;
  charged_title TEXT;
  charged_description TEXT;
BEGIN
  SELECT plan_id INTO active_plan
  FROM public.user_plan_access
  WHERE user_id = NEW.user_id
    AND status = 'active'
    AND starts_at <= statement_timestamp()
    AND expires_at > statement_timestamp();

  IF active_plan IS NULL THEN
    RAISE EXCEPTION 'PLAN_ACCESS_REQUIRED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.plan_document_charges (
    user_id, month_start, chat_id, doc_index, title, description
  )
  VALUES (
    NEW.user_id, current_month, NEW.chat_id, NEW.doc_index, trim(NEW.title), NEW.description
  )
  ON CONFLICT DO NOTHING;

  IF NOT FOUND THEN
    SELECT title, description
    INTO charged_title, charged_description
    FROM public.plan_document_charges
    WHERE user_id = NEW.user_id
      AND month_start = current_month
      AND chat_id = NEW.chat_id
      AND doc_index = NEW.doc_index;

    IF charged_title IS DISTINCT FROM trim(NEW.title)
      OR charged_description IS DISTINCT FROM NEW.description
    THEN
      RAISE EXCEPTION 'DOCUMENT_SLOT_ALREADY_CHARGED' USING ERRCODE = '23505';
    END IF;

    RETURN NEW;
  END IF;

  document_limit := CASE active_plan WHEN 'advanced' THEN 50 ELSE 25 END;

  INSERT INTO public.user_plan_monthly_usage (user_id, month_start, documents_generated)
  VALUES (NEW.user_id, current_month, 1)
  ON CONFLICT (user_id, month_start)
  DO UPDATE SET documents_generated =
    public.user_plan_monthly_usage.documents_generated + 1
  WHERE public.user_plan_monthly_usage.documents_generated < document_limit;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MONTHLY_DOCUMENT_LIMIT_REACHED' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.charge_plan_document(UUID, UUID, INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;