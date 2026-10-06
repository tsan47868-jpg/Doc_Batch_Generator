import { insforge } from '@/lib/insforge';

export type DocPlan = { title: string; description: string };

export type DocResult = {
  index: number;
  title: string;
  description: string;
  content: string;
  docx: string;
  docxKey?: string;
};

export type GenerationStatus = 'idle' | 'planning' | 'writing' | 'done' | 'error';

export type GenerationState = {
  chatId: string | null;
  running: boolean;
  status: GenerationStatus;
  plans: DocPlan[];
  results: DocResult[];
  failed: Record<number, string>;
  error: string | null;
  notice: string | null;
  sampleKey: string | null;
  sampleFileName: string | null;
  instructions: string;
};

export type RetryItem = { index: number; title: string; description: string };

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_TRANSPORT_ATTEMPTS = 3;
const RESEND_DELAYS_MS = [1500, 4000];
const MAX_AUTO_RESUMES = 2;
const PENDING_KEY = 'docgen.pending';
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type PendingRecord = {
  userId: string;
  chatId: string;
  sampleKey: string;
  sampleFileName: string;
  instructions: string;
  resumeCount: number;
  startedAt: number;
};

type RunOptions = {
  userId: string;
  chatId: string;
  file: File;
  instructions: string;
  sampleKey: string;
  sampleFileName: string;
  items: RetryItem[] | null;
};

let state: GenerationState = emptyState();
const listeners = new Set<() => void>();

function emptyState(): GenerationState {
  return {
    chatId: null,
    running: false,
    status: 'idle',
    plans: [],
    results: [],
    failed: {},
    error: null,
    notice: null,
    sampleKey: null,
    sampleFileName: null,
    instructions: '',
  };
}

function set(patch: Partial<GenerationState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeGeneration(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGeneration(): GenerationState {
  return state;
}

export function base64ToBlob(b64: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: DOCX_MIME });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isExpiredSessionMessage(message: string | null | undefined) {
  return /invalid or expired|sign in again|sign in to continue/i.test(message ?? '');
}

function readPending(): PendingRecord | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as PendingRecord;
    if (!record?.userId || !record?.chatId || !record?.sampleKey) return null;
    if (Date.now() - (record.startedAt ?? 0) > PENDING_MAX_AGE_MS) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

function writePending(record: PendingRecord) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(record));
  } catch {
    // Private browsing or full storage: resume-after-reload simply stays off.
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

async function persistDoc(userId: string, chatId: string, doc: DocResult) {
  const key = `${userId}/${chatId}/docs/${String(doc.index + 1).padStart(2, '0')}.docx`;
  const { data, error } = await insforge.storage
    .from('documents')
    .upload(key, base64ToBlob(doc.docx));
  if (error || !data) throw new Error(error?.message ?? 'storage upload failed');
  const { error: dbError } = await insforge.database.from('documents').insert([
    {
      chat_id: chatId,
      user_id: userId,
      doc_index: doc.index,
      title: doc.title,
      description: doc.description,
      content: doc.content,
      docx_url: data.url,
      docx_key: data.key,
    },
  ]);
  if (dbError) throw new Error(dbError.message);
}

async function persistPlan(chatId: string, plans: DocPlan[]) {
  try {
    await insforge.database
      .from('chats')
      .update({ plan_json: JSON.stringify(plans) })
      .eq('id', chatId);
  } catch {
    // Resume metadata is best-effort; generation itself must not fail because of it.
  }
}

function mergeResult(doc: DocResult) {
  const results = state.results.some((r) => r.index === doc.index)
    ? state.results.map((r) => (r.index === doc.index ? doc : r))
    : [...state.results, doc].sort((a, b) => a.index - b.index);
  const failed = { ...state.failed };
  delete failed[doc.index];
  set({ results, failed });
}

function buildForm(options: RunOptions): FormData {
  const form = new FormData();
  form.append('file', options.file);
  form.append('chatId', options.chatId);
  if (options.instructions) form.append('instructions', options.instructions);
  if (options.items) {
    form.append('retryMode', 'true');
    form.append('retry', JSON.stringify(options.items));
  }
  return form;
}

async function streamOnce(
  options: RunOptions,
): Promise<'ok' | 'retryable' | 'fatal'> {
  set({ status: options.items ? 'writing' : 'planning', notice: null });

  let response: Response;
  try {
    response = await fetch('/api/generate', {
      method: 'POST',
      headers: insforge.getHttpClient().getHeaders(),
      body: buildForm(options),
    });
  } catch {
    set({ error: 'The connection to the server was lost.' });
    return 'retryable';
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      message = data?.error || message;
    } catch {
      // keep default
    }
    set({ error: message });
    if (response.status >= 500) return 'retryable';
    return 'fatal';
  }
  if (!response.body) {
    set({ error: 'The server returned an empty response.' });
    return 'retryable';
  }

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;

        const event = JSON.parse(line) as
          | { type: 'plan'; documents: DocPlan[] }
          | { type: 'doc'; index: number; title: string; description: string; content: string; docx: string }
          | { type: 'doc_error'; index: number; message: string }
          | { type: 'error'; message: string };

        if (event.type === 'plan') {
          set({ plans: event.documents, status: 'writing' });
          void persistPlan(options.chatId, event.documents);
        } else if (event.type === 'doc') {
          const doc: DocResult = {
            index: event.index,
            title: event.title,
            description: event.description,
            content: event.content,
            docx: event.docx,
          };
          mergeResult(doc);
          try {
            await persistDoc(options.userId, options.chatId, doc);
          } catch (cause) {
            set({
              error: `"${doc.title}" was generated but could not be saved to your history: ${
                cause instanceof Error ? cause.message : 'unknown error'
              }`,
            });
          }
        } else if (event.type === 'doc_error') {
          set({ failed: { ...state.failed, [event.index]: event.message } });
        } else if (event.type === 'error') {
          set({ error: event.message, status: 'error' });
        }
      }
    }
    return 'ok';
  } catch {
    set({ error: 'The connection to the server was lost while documents were writing.' });
    return 'retryable';
  }
}

function missingPlanItems(): RetryItem[] | null {
  if (state.plans.length === 0) return null;
  const done = new Set(state.results.map((r) => r.index));
  return state.plans
    .map((plan, index) => ({ ...plan, index }))
    .filter((item) => !done.has(item.index));
}

function failedPlanItems(): RetryItem[] {
  return Object.keys(state.failed)
    .map(Number)
    .flatMap((index) =>
      state.plans[index]
        ? [{ index, title: state.plans[index].title, description: state.plans[index].description }]
        : [],
    );
}

async function runWithResends(options: RunOptions, allowDocRetry: boolean) {
  set({
    chatId: options.chatId,
    running: true,
    error: null,
    notice: null,
    sampleKey: options.sampleKey,
    sampleFileName: options.sampleFileName,
    instructions: options.instructions,
  });
  if (!options.items) set({ plans: [], results: [], failed: {}, status: 'planning' });
  else set({ status: 'writing' });

  let current = options;
  for (let attempt = 0; attempt < MAX_TRANSPORT_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      set({
        notice: `The request failed — sending it again (attempt ${attempt + 1} of ${MAX_TRANSPORT_ATTEMPTS})…`,
      });
      await sleep(RESEND_DELAYS_MS[attempt - 1] ?? 4000);
    }

    const outcome = await streamOnce(current);
    if (outcome === 'ok') {
      if (allowDocRetry && failedPlanItems().length > 0) {
        set({ notice: 'Some documents failed — sending them again…' });
        await streamOnce({ ...current, items: failedPlanItems() });
      }
      finishRun();
      return;
    }
    if (outcome === 'fatal') {
      finishRun();
      return;
    }

    const missing = missingPlanItems();
    if (missing && missing.length === 0) {
      finishRun();
      return;
    }
    current = { ...current, items: missing ?? current.items };
  }

  set({
    error:
      state.error ??
      'The connection kept failing. Documents completed so far are saved — open this chat again to continue.',
  });
  finishRun();
}

function finishRun() {
  const missing = missingPlanItems();
  const complete = state.plans.length === 0 || (missing?.length ?? 0) === 0;
  set({
    running: false,
    notice: null,
    status: state.status === 'planning' || state.status === 'writing'
      ? (state.error ? 'error' : 'done')
      : state.status,
  });
  if (complete || state.plans.length === 0) clearPending();
}

async function resolveFile(provided: File | undefined, sampleKey: string | null, sampleFileName: string | null): Promise<File | null> {
  if (provided) return provided;
  if (!sampleKey) return null;
  const { data } = await insforge.storage.from('documents').download(sampleKey);
  if (!data) return null;
  return new File([data], sampleFileName || 'sample');
}

export async function startGeneration(options: {
  userId: string;
  chatId: string;
  file: File;
  instructions: string;
  sampleKey: string;
  sampleFileName: string;
}) {
  if (state.running) return;
  writePending({
    userId: options.userId,
    chatId: options.chatId,
    sampleKey: options.sampleKey,
    sampleFileName: options.sampleFileName,
    instructions: options.instructions,
    resumeCount: 0,
    startedAt: Date.now(),
  });
  await runWithResends({ ...options, items: null }, true);
}

export async function retryItemsGeneration(chatId: string, items: RetryItem[], provided?: File) {
  if (state.running || items.length === 0) return;
  const file = await resolveFile(provided, state.sampleKey, state.sampleFileName);
  if (!file) {
    set({ error: 'The sample file for this chat could not be loaded for the retry.' });
    return;
  }
  set({ failed: {} });
  await runWithResends(
    {
      userId: '',
      chatId,
      file,
      instructions: state.instructions,
      sampleKey: state.sampleKey ?? '',
      sampleFileName: state.sampleFileName ?? file.name,
      items,
    },
    false,
  );
}

export async function restartAllGeneration(chatId: string, provided?: File) {
  if (state.running) return;
  const file = await resolveFile(provided, state.sampleKey, state.sampleFileName);
  if (!file) {
    set({ error: 'The sample file for this chat could not be loaded for the retry.' });
    return;
  }
  const { error } = await insforge.database.from('documents').delete().eq('chat_id', chatId);
  if (error) {
    set({ error: `Could not clear the previous documents: ${error.message}` });
    return;
  }
  const items: RetryItem[] = state.plans.length
    ? state.plans.map((plan, index) => ({ ...plan, index }))
    : [];
  set({ results: [], failed: [] as unknown as Record<number, string> });
  await runWithResends(
    {
      userId: '',
      chatId,
      file,
      instructions: state.instructions,
      sampleKey: state.sampleKey ?? '',
      sampleFileName: state.sampleFileName ?? file.name,
      items: items.length ? items : null,
    },
    true,
  );
}

export async function resumePendingGeneration(userId: string): Promise<string | null> {
  if (state.running) return state.chatId;
  const record = readPending();
  if (!record || record.userId !== userId) return null;

  const { data: chat } = await insforge.database
    .from('chats')
    .select('id, instructions, sample_key, sample_file_name, plan_json')
    .eq('id', record.chatId)
    .maybeSingle();
  const row = chat as
    | { id: string; instructions: string; sample_key: string; sample_file_name: string; plan_json: string }
    | null;
  if (!row) {
    clearPending();
    return null;
  }

  let plans: DocPlan[] = [];
  try {
    const parsed = JSON.parse(row.plan_json || '[]') as DocPlan[];
    if (Array.isArray(parsed)) plans = parsed;
  } catch {
    plans = [];
  }

  const { data: docs } = await insforge.database
    .from('documents')
    .select('doc_index, title, description, content, docx_key')
    .eq('chat_id', row.id)
    .order('doc_index');
  const rows = (docs ?? []) as {
    doc_index: number;
    title: string;
    description: string;
    content: string;
    docx_key: string;
  }[];

  const results: DocResult[] = rows.map((d) => ({
    index: d.doc_index,
    title: d.title,
    description: d.description,
    content: d.content,
    docx: '',
    docxKey: d.docx_key,
  }));
  const have = new Set(rows.map((d) => d.doc_index));
  const missing = plans
    .map((plan, index) => ({ ...plan, index }))
    .filter((item) => !have.has(item.index));

  set({
    chatId: row.id,
    plans,
    results,
    failed: {},
    error: null,
    notice: null,
    sampleKey: row.sample_key,
    sampleFileName: row.sample_file_name,
    instructions: row.instructions,
    status: missing.length > 0 ? 'writing' : 'done',
  });

  if (missing.length === 0) {
    clearPending();
    return row.id;
  }
  if (record.resumeCount >= MAX_AUTO_RESUMES) return row.id;

  const { data: sample } = await insforge.storage.from('documents').download(row.sample_key);
  if (!sample) return row.id;
  const file = new File([sample], row.sample_file_name || 'sample');

  writePending({ ...record, resumeCount: record.resumeCount + 1 });
  set({ notice: 'Continuing the documents that were still missing…' });
  void runWithResends(
    {
      userId,
      chatId: row.id,
      file,
      instructions: row.instructions,
      sampleKey: row.sample_key,
      sampleFileName: row.sample_file_name,
      items: missing,
    },
    false,
  );
  return row.id;
}
