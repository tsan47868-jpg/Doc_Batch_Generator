-- Per-user document generation history. RLS keeps every chat and its
-- documents visible only to the owning account.

CREATE TABLE public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  sample_file_name TEXT NOT NULL,
  sample_url TEXT NOT NULL,
  sample_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_index INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  docx_url TEXT NOT NULL,
  docx_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chat_id, doc_index)
);

CREATE INDEX chats_user_created_idx ON public.chats (user_id, created_at DESC);
CREATE INDEX documents_chat_idx ON public.documents (chat_id, doc_index);

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY chats_owner_select ON public.chats
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY chats_owner_insert ON public.chats
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY chats_owner_update ON public.chats
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY chats_owner_delete ON public.chats
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY documents_owner_select ON public.documents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY documents_owner_insert ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY documents_owner_update ON public.documents
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY documents_owner_delete ON public.documents
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
