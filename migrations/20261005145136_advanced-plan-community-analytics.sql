ALTER TABLE public.user_plan_access
  DROP CONSTRAINT IF EXISTS user_plan_access_plan_id_check;

ALTER TABLE public.user_plan_access
  ADD CONSTRAINT user_plan_access_plan_id_check
  CHECK (plan_id IN ('basic', 'advanced'));

ALTER TABLE public.user_plan_monthly_usage
  DROP CONSTRAINT IF EXISTS user_plan_monthly_usage_documents_generated_check,
  DROP CONSTRAINT IF EXISTS user_plan_monthly_usage_uploads_used_check;

ALTER TABLE public.user_plan_monthly_usage
  ADD CONSTRAINT user_plan_monthly_usage_documents_generated_check
    CHECK (documents_generated BETWEEN 0 AND 50),
  ADD CONSTRAINT user_plan_monthly_usage_uploads_used_check
    CHECK (uploads_used BETWEEN 0 AND 15);

CREATE TABLE public.plan_document_charges (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  doc_index INTEGER NOT NULL CHECK (doc_index BETWEEN 0 AND 9),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, month_start, chat_id, doc_index)
);

INSERT INTO public.plan_document_charges (user_id, month_start, chat_id, doc_index, created_at)
SELECT user_id,
       date_trunc('month', timezone('UTC', created_at))::date,
       chat_id,
       doc_index,
       created_at
FROM public.documents
ON CONFLICT DO NOTHING;

CREATE TABLE public.generation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('basic', 'advanced')),
  instructions TEXT NOT NULL DEFAULT '',
  request_kind TEXT NOT NULL CHECK (request_kind IN ('generate', 'retry')),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'partial', 'failed')),
  documents_requested INTEGER NOT NULL DEFAULT 0 CHECK (documents_requested BETWEEN 0 AND 10),
  documents_succeeded INTEGER NOT NULL DEFAULT 0 CHECK (documents_succeeded BETWEEN 0 AND 10),
  documents_failed INTEGER NOT NULL DEFAULT 0 CHECK (documents_failed BETWEEN 0 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX generation_requests_user_created_idx
  ON public.generation_requests (user_id, created_at DESC);

CREATE TABLE public.gemini_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_request_id UUID NOT NULL REFERENCES public.generation_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('planning', 'document')),
  doc_index INTEGER CHECK (doc_index BETWEEN 0 AND 9),
  model TEXT NOT NULL,
  http_status INTEGER CHECK (http_status BETWEEN 100 AND 599),
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  candidate_tokens INTEGER NOT NULL DEFAULT 0 CHECK (candidate_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX gemini_usage_events_user_created_idx
  ON public.gemini_usage_events (user_id, created_at DESC);
CREATE INDEX gemini_usage_events_request_idx
  ON public.gemini_usage_events (generation_request_id);

ALTER TABLE public.plan_document_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gemini_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_document_charges, public.generation_requests,
  public.gemini_usage_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_basic_plan_upload_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  current_month DATE := date_trunc('month', timezone('UTC', statement_timestamp()))::date;
  active_plan TEXT;
  upload_limit INTEGER;
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

  upload_limit := CASE active_plan WHEN 'advanced' THEN 15 ELSE 5 END;

  INSERT INTO public.user_plan_monthly_usage (user_id, month_start, uploads_used)
  VALUES (NEW.user_id, current_month, 1)
  ON CONFLICT (user_id, month_start)
  DO UPDATE SET uploads_used = public.user_plan_monthly_usage.uploads_used + 1
  WHERE public.user_plan_monthly_usage.uploads_used < upload_limit;

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
  active_plan TEXT;
  document_limit INTEGER;
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

  INSERT INTO public.plan_document_charges (user_id, month_start, chat_id, doc_index)
  VALUES (NEW.user_id, current_month, NEW.chat_id, NEW.doc_index)
  ON CONFLICT DO NOTHING;

  IF NOT FOUND THEN
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

CREATE TABLE public.communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.community_members (
  community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (community_id, user_id)
);

CREATE INDEX community_members_user_idx ON public.community_members (user_id);

CREATE TABLE public.community_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX community_invitations_community_idx
  ON public.community_invitations (community_id, created_at DESC);

CREATE TABLE public.community_shared_documents (
  community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  shared_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (community_id, document_id)
);

CREATE INDEX community_shared_documents_document_idx
  ON public.community_shared_documents (document_id);

CREATE TABLE public.community_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX community_messages_created_idx
  ON public.community_messages (community_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.is_active_community_member(
  target_community UUID,
  target_user UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.community_members member
    JOIN public.communities community ON community.id = member.community_id
    JOIN public.user_plan_access access ON access.user_id = community.owner_id
    WHERE member.community_id = target_community
      AND member.user_id = target_user
      AND access.plan_id = 'advanced'
      AND access.status = 'active'
      AND access.starts_at <= statement_timestamp()
      AND access.expires_at > statement_timestamp()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_community_owner(
  target_community UUID,
  target_user UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.communities community
    JOIN public.user_plan_access access ON access.user_id = community.owner_id
    WHERE community.id = target_community
      AND community.owner_id = target_user
      AND access.plan_id = 'advanced'
      AND access.status = 'active'
      AND access.starts_at <= statement_timestamp()
      AND access.expires_at > statement_timestamp()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_shared_document_key(
  object_key TEXT,
  target_user TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.documents document
    JOIN public.community_shared_documents shared ON shared.document_id = document.id
    WHERE document.docx_key = object_key
      AND public.is_active_community_member(shared.community_id, target_user::uuid)
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_community_owner_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_plan_access
    WHERE user_id = NEW.owner_id
      AND plan_id = 'advanced'
      AND status = 'active'
      AND starts_at <= statement_timestamp()
      AND expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'ACTIVE_ADVANCED_PLAN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_community_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.community_members (community_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_community_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  community_owner UUID;
  member_count INTEGER;
BEGIN
  SELECT owner_id INTO community_owner
  FROM public.communities
  WHERE id = NEW.community_id
  FOR UPDATE;

  IF community_owner IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_NOT_FOUND' USING ERRCODE = '23503';
  END IF;

  IF NEW.role = 'owner' AND NEW.user_id <> community_owner THEN
    RAISE EXCEPTION 'INVALID_COMMUNITY_OWNER' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_plan_access
    WHERE user_id = community_owner
      AND plan_id = 'advanced'
      AND status = 'active'
      AND starts_at <= statement_timestamp()
      AND expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'ACTIVE_ADVANCED_PLAN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO member_count
  FROM public.community_members
  WHERE community_id = NEW.community_id;
  IF member_count >= 5 THEN
    RAISE EXCEPTION 'COMMUNITY_SEAT_LIMIT_REACHED' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_community_invitation_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  community_owner UUID;
  occupied_seats INTEGER;
BEGIN
  SELECT owner_id INTO community_owner
  FROM public.communities
  WHERE id = NEW.community_id
  FOR UPDATE;

  IF community_owner IS NULL OR NEW.invited_by <> community_owner THEN
    RAISE EXCEPTION 'ONLY_COMMUNITY_OWNER_CAN_INVITE' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_plan_access
    WHERE user_id = community_owner
      AND plan_id = 'advanced'
      AND status = 'active'
      AND starts_at <= statement_timestamp()
      AND expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'ACTIVE_ADVANCED_PLAN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT
    (SELECT count(*) FROM public.community_members WHERE community_id = NEW.community_id)
    + (SELECT count(*) FROM public.community_invitations
       WHERE community_id = NEW.community_id
         AND accepted_at IS NULL
         AND expires_at > statement_timestamp())
  INTO occupied_seats;

  IF occupied_seats >= 5 THEN
    RAISE EXCEPTION 'COMMUNITY_SEAT_LIMIT_REACHED' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.community_members member
    JOIN auth.users account ON account.id = member.user_id
    WHERE member.community_id = NEW.community_id
      AND lower(account.email) = lower(NEW.email)
  ) OR EXISTS (
    SELECT 1 FROM public.community_invitations invite
    WHERE invite.community_id = NEW.community_id
      AND lower(invite.email) = lower(NEW.email)
      AND invite.accepted_at IS NULL
      AND invite.expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_INVITATION_ALREADY_EXISTS' USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_community_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM realtime.publish(
    'community:' || NEW.community_id::text,
    'new_message',
    jsonb_build_object(
      'id', NEW.id,
      'community_id', NEW.community_id,
      'sender_id', NEW.sender_id,
      'body', NEW.body,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chats_enforce_basic_plan_upload_limit ON public.chats;
DROP TRIGGER IF EXISTS documents_enforce_basic_plan_document_limit ON public.documents;

CREATE TRIGGER chats_enforce_plan_upload_limit
  BEFORE INSERT ON public.chats
  FOR EACH ROW EXECUTE FUNCTION public.enforce_basic_plan_upload_limit();

CREATE TRIGGER documents_enforce_plan_document_limit
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_basic_plan_document_limit();

CREATE TRIGGER communities_require_advanced_plan
  BEFORE INSERT ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.enforce_community_owner_plan();

CREATE TRIGGER communities_add_owner
  AFTER INSERT ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.add_community_owner();

CREATE TRIGGER community_members_enforce_seat_limit
  BEFORE INSERT ON public.community_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_community_seat_limit();

CREATE TRIGGER community_invitations_enforce_seat_limit
  BEFORE INSERT ON public.community_invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_community_invitation_seat_limit();

CREATE TRIGGER community_messages_publish
  AFTER INSERT ON public.community_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_community_message();

ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_shared_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.communities, public.community_members,
  public.community_invitations, public.community_shared_documents,
  public.community_messages FROM anon, authenticated;

GRANT SELECT ON public.communities, public.community_members,
  public.community_shared_documents, public.community_messages TO authenticated;
GRANT INSERT ON public.community_messages TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_active_community_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_community_owner(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_shared_document_key(TEXT, TEXT) TO authenticated;

CREATE POLICY communities_member_select ON public.communities
  FOR SELECT TO authenticated
  USING (public.is_active_community_member(id, (SELECT auth.uid())));

CREATE POLICY community_members_member_select ON public.community_members
  FOR SELECT TO authenticated
  USING (public.is_active_community_member(community_id, (SELECT auth.uid())));

CREATE POLICY community_shared_documents_member_select ON public.community_shared_documents
  FOR SELECT TO authenticated
  USING (public.is_active_community_member(community_id, (SELECT auth.uid())));

CREATE POLICY community_messages_member_select ON public.community_messages
  FOR SELECT TO authenticated
  USING (public.is_active_community_member(community_id, (SELECT auth.uid())));

CREATE POLICY community_messages_member_insert ON public.community_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND public.is_active_community_member(community_id, (SELECT auth.uid()))
  );

CREATE POLICY documents_shared_member_select ON public.documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_shared_documents shared
      WHERE shared.document_id = documents.id
        AND public.is_active_community_member(shared.community_id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS storage_objects_shared_documents_select ON storage.objects;
CREATE POLICY storage_objects_shared_documents_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket = 'documents'
    AND public.can_read_shared_document_key(key, (SELECT auth.jwt() ->> 'sub'))
  );

INSERT INTO realtime.channels (pattern, description, enabled)
VALUES ('community:%', 'Advanced plan community chat', true)
ON CONFLICT (pattern) DO UPDATE
SET description = EXCLUDED.description,
    enabled = EXCLUDED.enabled;

ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS community_members_subscribe ON realtime.channels;
CREATE POLICY community_members_subscribe ON realtime.channels
  FOR SELECT TO authenticated
  USING (
    pattern = 'community:%'
    AND public.is_active_community_member(
      NULLIF(split_part(realtime.channel_name(), ':', 2), '')::uuid,
      (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS community_members_publish ON realtime.messages;
CREATE POLICY community_members_publish ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    channel_name LIKE 'community:%'
    AND public.is_active_community_member(
      NULLIF(split_part(channel_name, ':', 2), '')::uuid,
      (SELECT auth.uid())
    )
  );

REVOKE ALL ON FUNCTION public.enforce_basic_plan_upload_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_basic_plan_document_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_community_owner_plan() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_community_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_community_seat_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_community_invitation_seat_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_community_message() FROM PUBLIC, anon, authenticated;