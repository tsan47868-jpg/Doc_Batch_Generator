CREATE OR REPLACE FUNCTION public.accept_community_invitation(
  invitation_token_hash TEXT,
  accepting_user UUID,
  accepting_email TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  invitation public.community_invitations%ROWTYPE;
BEGIN
  SELECT * INTO invitation
  FROM public.community_invitations
  WHERE token_hash = invitation_token_hash
  FOR UPDATE;

  IF invitation.id IS NULL
    OR invitation.accepted_at IS NOT NULL
    OR invitation.expires_at <= statement_timestamp()
    OR lower(invitation.email) <> lower(accepting_email)
  THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.communities
  WHERE id = invitation.community_id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_plan_access access
    JOIN public.communities community ON community.owner_id = access.user_id
    WHERE community.id = invitation.community_id
      AND access.plan_id = 'advanced'
      AND access.status = 'active'
      AND access.starts_at <= statement_timestamp()
      AND access.expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_OWNER_PLAN_INACTIVE' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.community_members
    WHERE community_id = invitation.community_id
      AND user_id = accepting_user
  ) THEN
    UPDATE public.community_invitations
    SET accepted_at = statement_timestamp()
    WHERE id = invitation.id;
    RETURN invitation.community_id;
  END IF;

  UPDATE public.community_invitations
  SET accepted_at = statement_timestamp()
  WHERE id = invitation.id;

  INSERT INTO public.community_members (community_id, user_id, role)
  VALUES (invitation.community_id, accepting_user, 'member');

  RETURN invitation.community_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_community_invitation(TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;