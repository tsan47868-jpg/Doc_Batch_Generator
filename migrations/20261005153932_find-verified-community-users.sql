CREATE OR REPLACE FUNCTION public.find_verified_community_user(target_email TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users account
    WHERE lower(btrim(account.email)) = lower(btrim(target_email))
      AND account.email_verified = TRUE
      AND account.is_anonymous = FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.find_verified_community_user(TEXT)
  FROM PUBLIC, anon, authenticated;