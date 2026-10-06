-- Persist the proposed document plan on the chat so an interrupted generation
-- can be resumed later: the app compares the plan against saved documents and
-- re-requests only the missing indices.
ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS plan_json TEXT NOT NULL DEFAULT '[]';
