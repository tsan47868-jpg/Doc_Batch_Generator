DROP POLICY IF EXISTS communities_member_select ON public.communities;
DROP POLICY IF EXISTS community_members_member_select ON public.community_members;
DROP POLICY IF EXISTS community_shared_documents_member_select ON public.community_shared_documents;
DROP POLICY IF EXISTS community_messages_member_select ON public.community_messages;
DROP POLICY IF EXISTS community_messages_member_insert ON public.community_messages;
DROP POLICY IF EXISTS documents_shared_member_select ON public.documents;
DROP POLICY IF EXISTS storage_objects_shared_documents_select ON storage.objects;
DROP POLICY IF EXISTS community_members_subscribe ON realtime.channels;
DROP POLICY IF EXISTS community_members_publish ON realtime.messages;

DROP FUNCTION IF EXISTS public.can_read_shared_document_key(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.is_active_community_member(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_community_owner(UUID, UUID);

CREATE FUNCTION public.is_active_community_member(target_community UUID)
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
      AND member.user_id = (SELECT auth.uid())
      AND access.plan_id = 'advanced'
      AND access.status = 'active'
      AND access.starts_at <= statement_timestamp()
      AND access.expires_at > statement_timestamp()
  );
$$;

CREATE FUNCTION public.is_community_owner(target_community UUID)
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
      AND community.owner_id = (SELECT auth.uid())
      AND access.plan_id = 'advanced'
      AND access.status = 'active'
      AND access.starts_at <= statement_timestamp()
      AND access.expires_at > statement_timestamp()
  );
$$;

CREATE FUNCTION public.can_read_shared_document_key(object_key TEXT)
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
      AND public.is_active_community_member(shared.community_id)
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_community_member(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_community_owner(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_shared_document_key(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_community_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_community_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_shared_document_key(TEXT) TO authenticated;

CREATE POLICY communities_member_select ON public.communities
  FOR SELECT TO authenticated
  USING (public.is_active_community_member(id));

CREATE POLICY community_members_member_select ON public.community_members
  FOR SELECT TO authenticated
  USING (public.is_active_community_member(community_id));

CREATE POLICY community_shared_documents_member_select ON public.community_shared_documents
  FOR SELECT TO authenticated
  USING (public.is_active_community_member(community_id));

CREATE POLICY community_messages_member_select ON public.community_messages
  FOR SELECT TO authenticated
  USING (public.is_active_community_member(community_id));

CREATE POLICY community_messages_member_insert ON public.community_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND public.is_active_community_member(community_id)
  );

CREATE POLICY documents_shared_member_select ON public.documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_shared_documents shared
      WHERE shared.document_id = documents.id
        AND public.is_active_community_member(shared.community_id)
    )
  );

CREATE POLICY storage_objects_shared_documents_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket = 'documents'
    AND public.can_read_shared_document_key(key)
  );

CREATE POLICY community_members_subscribe ON realtime.channels
  FOR SELECT TO authenticated
  USING (
    pattern = 'community:%'
    AND public.is_active_community_member(
      NULLIF(split_part(realtime.channel_name(), ':', 2), '')::uuid
    )
  );

CREATE POLICY community_members_publish ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    channel_name LIKE 'community:%'
    AND public.is_active_community_member(
      NULLIF(split_part(channel_name, ':', 2), '')::uuid
    )
  );