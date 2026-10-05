CREATE TABLE public.generation_request_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_request_id UUID NOT NULL
    REFERENCES public.generation_requests(id) ON DELETE CASCADE,
  doc_index INTEGER NOT NULL CHECK (doc_index BETWEEN 0 AND 9),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('generated', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (generation_request_id, doc_index)
);

CREATE INDEX generation_request_documents_request_idx
  ON public.generation_request_documents (generation_request_id, doc_index);

ALTER TABLE public.generation_request_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.generation_request_documents FROM anon, authenticated;