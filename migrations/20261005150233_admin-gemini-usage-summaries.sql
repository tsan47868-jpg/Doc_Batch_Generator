CREATE OR REPLACE FUNCTION public.admin_gemini_usage_summary(
  target_user_ids UUID[],
  month_start TIMESTAMPTZ
)
RETURNS TABLE (
  user_id UUID,
  request_count BIGINT,
  prompt_tokens BIGINT,
  candidate_tokens BIGINT,
  total_tokens BIGINT,
  failed_requests BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT event.user_id,
         count(*)::bigint,
         coalesce(sum(event.prompt_tokens), 0)::bigint,
         coalesce(sum(event.candidate_tokens), 0)::bigint,
         coalesce(sum(event.total_tokens), 0)::bigint,
         count(*) FILTER (WHERE NOT event.success)::bigint
  FROM public.gemini_usage_events event
  WHERE event.user_id = ANY(target_user_ids)
    AND event.created_at >= month_start
  GROUP BY event.user_id;
$$;

CREATE OR REPLACE FUNCTION public.admin_gemini_activity_summary(
  target_request_ids UUID[]
)
RETURNS TABLE (
  generation_request_id UUID,
  call_count BIGINT,
  prompt_tokens BIGINT,
  candidate_tokens BIGINT,
  total_tokens BIGINT,
  failed_calls BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT event.generation_request_id,
         count(*)::bigint,
         coalesce(sum(event.prompt_tokens), 0)::bigint,
         coalesce(sum(event.candidate_tokens), 0)::bigint,
         coalesce(sum(event.total_tokens), 0)::bigint,
         count(*) FILTER (WHERE NOT event.success)::bigint
  FROM public.gemini_usage_events event
  WHERE event.generation_request_id = ANY(target_request_ids)
  GROUP BY event.generation_request_id;
$$;

REVOKE ALL ON FUNCTION public.admin_gemini_usage_summary(UUID[], TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_gemini_activity_summary(UUID[])
  FROM PUBLIC, anon, authenticated;