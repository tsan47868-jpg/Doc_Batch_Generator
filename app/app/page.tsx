'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import JSZip from 'jszip';
import type { UserSchema } from '@insforge/sdk';
import { insforge } from '@/lib/insforge';

type DocPlan = { title: string; description: string };

type DocResult = {
  index: number;
  title: string;
  description: string;
  content: string;
  docx: string;
  docxKey?: string;
};

type ChatSummary = {
  id: string;
  title: string;
  created_at: string;
};

type ChatDetail = {
  id: string;
  instructions: string;
  sample_file_name: string;
  sample_key: string;
};

type PlanStatus = {
  plan: 'basic' | 'advanced' | null;
  active: boolean;
  expiresAt: string | null;
  usage: {
    documentsGenerated: number;
    documentsLimit: number;
    documentsRemaining: number;
    uploadsUsed: number;
    uploadsLimit: number;
    uploadsRemaining: number;
  };
};

type DocRow = {
  doc_index: number;
  title: string;
  description: string;
  content: string;
  docx_key: string;
};

type Status = 'idle' | 'planning' | 'writing' | 'done' | 'error';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function slug(t: string) {
  return (
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'document'
  );
}

function base64ToBlob(b64: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: DOCX_MIME });
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-spin border-t-accent ${className}`}
    />
  );
}

function PlusIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function FileIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M14.5 13.5V5.41a1 1 0 0 0-.3-.7L9.8.29A1 1 0 0 0 9.08 0H1.5v13.5A2.5 2.5 0 0 0 4 16h8a2.5 2.5 0 0 0 2.5-2.5m-1.5 0v-7H8v-5H3v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1M9.5 5V2.12L12.38 5zM5.13 5h-.62v1.25h2.12V5zm-.62 3h7.12v1.25H4.5zm.62 3h-.62v1.25h7.12V11z"
        clipRule="evenodd"
        fillRule="evenodd"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

type AuthMode = 'signin' | 'signup' | 'verify';

function AuthScreen({ onAuthed }: { onAuthed: (user: UserSchema) => void }) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');

  function switchMode(next: AuthMode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);

    if (mode !== 'verify' && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signin') {
        const { data, error } = await insforge.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (data?.user) onAuthed(data.user);
      } else if (mode === 'signup') {
        const { data, error } = await insforge.auth.signUp({
          email: email.trim(),
          password,
          name: name.trim() || undefined,
        });
        if (error) throw error;
        if (data?.requireEmailVerification) {
          setPendingEmail(email.trim());
          setCode('');
          setMode('verify');
          setNotice(
            `We emailed a 6-digit code to ${email.trim()}. Enter it below to finish creating your account.`,
          );
        } else if (data?.user) {
          onAuthed(data.user);
        }
      } else {
        const { data, error } = await insforge.auth.verifyEmail({
          email: pendingEmail,
          otp: code.trim(),
        });
        if (error) throw error;
        if (data?.user) onAuthed(data.user);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error } = await insforge.auth.resendVerificationEmail({
        email: pendingEmail,
      });
      if (error) throw error;
      setNotice('A new code has been sent.');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not resend the code.',
      );
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === 'verify'
      ? 'Verify your email'
      : mode === 'signup'
        ? 'Create your account'
        : 'Welcome back';
  const submitLabel =
    mode === 'verify'
      ? 'Verify and sign in'
      : mode === 'signup'
        ? 'Create account'
        : 'Sign in';

  const fieldClass =
    'w-full rounded-xl border border-line bg-app px-4 py-2.5 text-[15px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent';

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-app px-4 py-10 text-ink">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-line bg-bubble">
            <FileIcon className="h-5 w-5 text-mute" />
          </span>
          <h1 className="text-2xl font-medium">Doc Batch Generator</h1>
          <p className="text-sm text-faint">{heading}</p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-3 rounded-3xl border border-composerline bg-bubble p-5"
        >
          {mode === 'signup' && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              autoComplete="name"
              className={fieldClass}
            />
          )}

          {mode === 'verify' ? (
            <input
              type="text"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              className={`${fieldClass} text-center tracking-[0.4em]`}
            />
          ) : (
            <>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                autoComplete="email"
                required
                className={fieldClass}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete={
                  mode === 'signup' ? 'new-password' : 'current-password'
                }
                required
                className={fieldClass}
              />
            </>
          )}

          <button
            type="submit"
            disabled={busy || (mode === 'verify' && code.length < 6)}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {busy && <Spinner />}
            {submitLabel}
          </button>

          {mode === 'verify' && (
            <div className="flex items-center justify-between px-1 pt-1 text-xs">
              <button
                type="button"
                onClick={resendCode}
                disabled={busy}
                className="text-accent-soft transition-colors hover:text-accent disabled:opacity-60"
              >
                Resend code
              </button>
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-faint transition-colors hover:text-ink"
              >
                Back to sign in
              </button>
            </div>
          )}
        </form>

        {mode !== 'verify' && (
          <p className="mt-4 text-center text-sm text-faint">
            {mode === 'signin'
              ? "Don't have an account? "
              : 'Already have an account? '}
            <button
              type="button"
              onClick={() =>
                switchMode(mode === 'signin' ? 'signup' : 'signin')
              }
              className="text-accent-soft transition-colors hover:text-accent"
            >
              {mode === 'signin' ? 'Create one' : 'Sign in'}
            </button>
          </p>
        )}

        {notice && (
          <p className="mt-3 text-center text-xs text-emerald-500">{notice}</p>
        )}
        {error && (
          <p className="mt-3 text-center text-xs text-amber-500">{error}</p>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [input, setInput] = useState('');
  const [sent, setSent] = useState<{ text: string; fileName: string } | null>(null);
  const [plans, setPlans] = useState<DocPlan[]>([]);
  const [results, setResults] = useState<DocResult[]>([]);
  const [failed, setFailed] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [light, setLight] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<UserSchema | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [planStatus, setPlanStatus] = useState<PlanStatus | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sampleKey, setSampleKey] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sampleRef = useRef<{ file: File; instructions: string } | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const busy = status === 'planning' || status === 'writing';
  const started = sent !== null;

  const refreshPlan = useCallback(async () => {
    setPlanError(null);
    try {
      const response = await fetch('/api/plan', {
        headers: insforge.getHttpClient().getHeaders(),
        cache: 'no-store',
      });
      const result = (await response.json()) as PlanStatus & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not load plan status.');
      setPlanStatus(result);
    } catch (cause) {
      setPlanStatus(null);
      setPlanError(cause instanceof Error ? cause.message : 'Could not load plan status.');
    }
  }, []);

  useEffect(() => {
    if (!started) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [results.length, plans.length, status, started]);

  useEffect(() => {
    setLight(document.documentElement.classList.contains('light'));
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) autoGrow(el);
  }, [input]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    let cancelled = false;
    insforge.auth.getCurrentUser().then(({ data }) => {
      if (cancelled) return;
      setUser(data?.user ?? null);
      setAuthReady(true);
      if (data?.user) void refreshPlan();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshPlan]);

  useEffect(() => {
    if (!user) return;
    const token = new URLSearchParams(window.location.search).get('communityInvite');
    if (token) {
      router.replace(`/community?invite=${encodeURIComponent(token)}`);
    }
  }, [router, user]);

  const refreshHistory = useCallback(async () => {
    const { data } = await insforge.database
      .from('chats')
      .select('id, title, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    setHistory((data ?? []) as ChatSummary[]);
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshHistory();
  }, [user?.id, refreshHistory]);

  const pickFile = useCallback((f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setHint(null);
    setError(null);
  }, []);

  function reset() {
    sampleRef.current = null;
    chatIdRef.current = null;
    setFile(null);
    setInput('');
    setSent(null);
    setPlans([]);
    setResults([]);
    setFailed({});
    setStatus('idle');
    setError(null);
    setHint(null);
    setPreviewIndex(null);
    setActiveChatId(null);
    setSampleKey(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    // empty -> stay 'auto' so the textarea stretches to the wrapped placeholder
    el.style.height = el.value ? `${Math.min(el.scrollHeight, 200)}px` : 'auto';
  }

  function toggleTheme() {
    const next = !document.documentElement.classList.contains('light');
    document.documentElement.classList.toggle('light', next);
    try {
      localStorage.setItem('theme', next ? 'light' : 'dark');
    } catch {}
    setLight(next);
  }

  async function logout() {
    const { error } = await insforge.auth.signOut();
    if (error) {
      setError(error.message);
      return;
    }
    setUser(null);
    setHistory([]);
    setPlanStatus(null);
    reset();
  }

  function handleAuthed(u: UserSchema) {
    setUser(u);
    void refreshPlan();
    reset();
  }

  async function persistDoc(chatId: string, doc: DocResult) {
    const userId = user?.id;
    if (!userId) throw new Error('Not signed in');
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

  async function streamGeneration(form: FormData, retryMode: boolean, chatId: string) {
    setError(null);
    setHint(null);
    setStatus(retryMode ? 'writing' : 'planning');

    const saves: Promise<unknown>[] = [];

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: insforge.getHttpClient().getHeaders(),
        body: form,
      });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const data = await res.json();
          msg = data?.error || msg;
        } catch {
          // keep default
        }
        throw new Error(msg);
      }

      const reader = res.body!.getReader();
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

          const event = JSON.parse(line);
          if (event.type === 'plan') {
            setPlans(event.documents);
            setStatus('writing');
          } else if (event.type === 'doc') {
            const doc: DocResult = event;
            setResults((prev) =>
              prev.some((r) => r.index === doc.index)
                ? prev.map((r) => (r.index === doc.index ? doc : r))
                : [...prev, doc].sort((a, b) => a.index - b.index),
            );
            setFailed((prev) => {
              if (!(doc.index in prev)) return prev;
              const next = { ...prev };
              delete next[doc.index];
              return next;
            });
            saves.push(
              persistDoc(chatId, doc).catch((e) => {
                setError(
                  `"${doc.title}" was generated but could not be saved to your history: ${
                    e instanceof Error ? e.message : 'unknown error'
                  }`,
                );
              }),
            );
          } else if (event.type === 'doc_error') {
            setFailed((prev) => ({ ...prev, [event.index]: event.message }));
          } else if (event.type === 'error') {
            setError(event.message);
            setStatus('error');
          }
        }
      }

      await Promise.allSettled(saves);
      await refreshPlan();
      setStatus((s) => (s === 'planning' || s === 'writing' ? 'done' : s));
      refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed.');
      setStatus('error');
    }
  }

  async function send() {
    if (busy || !user) return;
    const text = input.trim();
    if (!file) {
      setHint('Attach a sample file with the + button so I can learn its style first.');
      return;
    }

    try {
      const planResponse = await fetch('/api/plan', {
        headers: insforge.getHttpClient().getHeaders(),
        cache: 'no-store',
      });
      const plan = (await planResponse.json()) as PlanStatus & { error?: string };
      if (!planResponse.ok) throw new Error(plan.error || 'Could not verify plan access.');
      setPlanStatus(plan);
      if (!plan.active) {
        setError('Your plan is not active. Contact the administrator for access.');
        return;
      }
      if (plan.usage.uploadsUsed >= plan.usage.uploadsLimit) {
        setError(`You have reached the ${plan.usage.uploadsLimit}-upload limit for this month.`);
        return;
      }
      if (plan.usage.documentsGenerated >= plan.usage.documentsLimit) {
        setError(`You have reached the ${plan.usage.documentsLimit}-document limit for this month.`);
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not verify plan access.');
      return;
    }

    const chatId = crypto.randomUUID();
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0 ? file.name.slice(dot) : '';
    const key = `${user.id}/${chatId}/sample${ext}`;

    setError(null);
    setHint(null);
    setStatus('planning');

    const { data: uploaded, error: uploadError } = await insforge.storage
      .from('documents')
      .upload(key, file);
    if (uploadError || !uploaded) {
      setError(uploadError?.message ?? 'Could not upload your sample file.');
      setStatus('idle');
      return;
    }

    const title = (text.length > 0 ? text : file.name).slice(0, 60);
    const { error: chatError } = await insforge.database.from('chats').insert([
      {
        id: chatId,
        user_id: user.id,
        title,
        instructions: text,
        sample_file_name: file.name,
        sample_url: uploaded.url,
        sample_key: uploaded.key,
      },
    ]);
    if (chatError) {
      setError(chatError.message);
      setStatus('idle');
      return;
    }
    void refreshPlan();

    const form = new FormData();
    form.append('file', file);
    form.append('instructions', text);
    form.append('chatId', chatId);

    chatIdRef.current = chatId;
    setActiveChatId(chatId);
    setSampleKey(uploaded.key);
    sampleRef.current = { file, instructions: text };
    setSent({ text, fileName: file.name });
    setHistory((prev) => [
      { id: chatId, title, created_at: new Date().toISOString() },
      ...prev,
    ]);
    setFile(null);
    setInput('');
    setPlans([]);
    setResults([]);
    setFailed({});
    setPreviewIndex(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    await streamGeneration(form, false, chatId);
  }

  async function retryAll() {
    if (busy || !sampleRef.current) return;
    const chatId = chatIdRef.current;
    if (!chatId) return;
    const { error } = await insforge.database
      .from('documents')
      .delete()
      .eq('chat_id', chatId);
    if (error) {
      setError(`Could not clear the previous documents: ${error.message}`);
      return;
    }
    const form = new FormData();
    form.append('file', sampleRef.current.file);
    form.append('instructions', sampleRef.current.instructions);
    form.append('chatId', chatId);
    form.append('retryMode', 'true');
    form.append(
      'retry',
      JSON.stringify(
        plans.map((plan, index) => ({ ...plan, index })),
      ),
    );
    await streamGeneration(form, false, chatId);
  }

  async function retryFailed() {
    if (busy || !sampleRef.current) return;
    const items = Object.keys(failed)
      .map(Number)
      .flatMap((i) =>
        plans[i]
          ? [{ index: i, title: plans[i].title, description: plans[i].description }]
          : [],
      );
    if (items.length === 0) return;

    const chatId = chatIdRef.current;
    if (!chatId) return;
    const form = new FormData();
    form.append('file', sampleRef.current.file);
    form.append('chatId', chatId);
    form.append('retryMode', 'true');
    form.append('retry', JSON.stringify(items));
    setFailed({});
    setPreviewIndex(null);

    await streamGeneration(form, true, chatId);
  }

  async function docBlob(doc: DocResult): Promise<Blob | null> {
    if (doc.docx) return base64ToBlob(doc.docx);
    if (doc.docxKey) {
      const { data } = await insforge.storage.from('documents').download(doc.docxKey);
      return data ?? null;
    }
    return null;
  }

  async function downloadOne(doc: DocResult) {
    const blob = await docBlob(doc);
    if (!blob) {
      setError('Could not download this document.');
      return;
    }
    download(blob, `${String(doc.index + 1).padStart(2, '0')}-${slug(doc.title)}.docx`);
  }

  async function downloadAll() {
    const zip = new JSZip();
    for (const r of results) {
      const blob = await docBlob(r);
      if (blob) {
        zip.file(`${String(r.index + 1).padStart(2, '0')}-${slug(r.title)}.docx`, blob);
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, 'generated-documents.zip');
  }

  async function downloadSample() {
    if (!sampleKey || !sent) return;
    const { data, error } = await insforge.storage
      .from('documents')
      .download(sampleKey);
    if (error || !data) {
      setError('Could not download the sample file.');
      return;
    }
    download(data, sent.fileName);
  }

  async function openChat(id: string) {
    if (busy) return;
    const { data: chats } = await insforge.database
      .from('chats')
      .select('id, instructions, sample_file_name, sample_key')
      .eq('id', id)
      .limit(1);
    const chat = (chats as ChatDetail[] | null)?.[0];
    if (!chat) {
      setError('This chat could not be loaded.');
      return;
    }
    const { data: docs } = await insforge.database
      .from('documents')
      .select('doc_index, title, description, content, docx_key')
      .eq('chat_id', id)
      .order('doc_index');
    const rows = (docs ?? []) as DocRow[];
    const nextPlans: DocPlan[] = [];
    rows.forEach((d) => {
      nextPlans[d.doc_index] = { title: d.title, description: d.description };
    });
    setSent({ text: chat.instructions, fileName: chat.sample_file_name });
    setSampleKey(chat.sample_key);
    chatIdRef.current = id;
    sampleRef.current = null;
    setActiveChatId(id);
    setPlans(nextPlans);
    setResults(
      rows.map((d) => ({
        index: d.doc_index,
        title: d.title,
        description: d.description,
        content: d.content,
        docx: '',
        docxKey: d.docx_key,
      })),
    );
    setFailed({});
    setStatus('done');
    setError(null);
    setHint(null);
    setPreviewIndex(null);
  }

  const canSend = !busy && (input.trim().length > 0 || file !== null);
  const failedCount = Object.keys(failed).length;

  if (!authReady) {
    return (
      <div className="flex h-dvh items-center justify-center bg-app">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthed={handleAuthed} />;
  }

  const inputBar = (
    <div
      className={`flex w-full flex-col rounded-[26px] border border-composerline bg-bubble p-2.5 transition-shadow ${
        dragging ? 'ring-2 ring-accent' : ''
      }`}
    >
      {file && (
        <div className="px-2 pb-2 pt-1">
          <span className="inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-app px-3 py-1.5 text-sm text-ink">
            <FileIcon className="h-4 w-4 shrink-0 text-mute" />
            <span className="truncate">{file.name}</span>
            <button
              onClick={() => setFile(null)}
              className="shrink-0 rounded-full p-0.5 text-faint hover:bg-xhover hover:text-ink"
              aria-label="Remove file"
            >
              <XIcon />
            </button>
          </span>
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          aria-label="Attach sample file"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-hover2 disabled:opacity-40"
        >
          <PlusIcon />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.docx"
          className="hidden"
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div className="grid min-w-0 flex-1">
          {input === '' && (
            <div
              aria-hidden
              className={`col-start-1 row-start-1 select-none break-words py-1.5 text-base leading-6 text-faint sm:text-[15px] ${
                busy ? 'opacity-60' : ''
              }`}
            >
              {busy
                ? 'Generating your documents…'
                : 'Ask anything — attach a sample and describe the documents you need'}
            </div>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            disabled={busy}
            aria-label="Ask anything"
            onChange={(e) => {
              setInput(e.target.value);
              setHint(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className="col-start-1 row-start-1 max-h-[200px] resize-none bg-transparent py-1.5 text-base leading-6 text-ink outline-none disabled:opacity-60 sm:text-[15px]"
          />
        </div>
        <button
          onClick={send}
          disabled={!canSend}
          aria-label="Send"
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${
            canSend
              ? 'bg-accent text-white hover:bg-accent-hover'
              : 'bg-hover2 text-faint'
          }`}
        >
          <ArrowUpIcon />
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="flex h-dvh bg-app text-ink"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pickFile(e.dataTransfer.files?.[0]);
      }}
    >
      {menuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMenuOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] shrink-0 flex-col bg-panel p-2 transition-transform duration-200 ease-out md:static md:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-2 py-3 text-sm font-semibold">
          <span className="flex min-w-0 items-center gap-2">
            <FileIcon className="h-5 w-5 shrink-0 text-mute" />
            <span className="truncate">Doc Batch Generator</span>
          </span>
          <button
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
            className="shrink-0 rounded-lg p-2 text-mute hover:bg-hover hover:text-ink md:hidden"
          >
            <XIcon />
          </button>
        </div>
        <button
          onClick={() => {
            reset();
            setMenuOpen(false);
          }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-hover"
        >
          <NewChatIcon />
          New chat
        </button>
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          {light ? <MoonIcon /> : <SunIcon />}
          {light ? 'Dark mode' : 'Light mode'}
        </button>
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <HomeIcon />
          Home
        </Link>
        {user.email.toLowerCase() ===
          process.env.NEXT_PUBLIC_ADMIN_EMAIL?.trim().toLowerCase() && (
          <Link
            href="/admin"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            Plan access
          </Link>
        )}

        <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-divider pt-3">
          <p className="px-3 pb-1 text-xs font-medium text-faint">History</p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {history.length === 0 && (
              <p className="px-3 py-2 text-xs text-faint">No chats yet</p>
            )}
            {history.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  openChat(c.id);
                  setMenuOpen(false);
                }}
                className={`block w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-hover ${
                  activeChatId === c.id
                    ? 'bg-hover text-ink'
                    : 'text-mute hover:text-ink'
                }`}
              >
                <span className="block truncate text-sm">{c.title}</span>
                <span className="block text-xs text-faint">
                  {new Date(c.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-auto border-t border-divider pt-3">
          <div className="mb-2 rounded-lg bg-app px-3 py-2">
            <p className="text-xs font-medium text-ink">
              {planStatus?.active
                ? `${planStatus.plan === 'advanced' ? 'Advanced' : 'Basic'} plan active`
                : 'Plan inactive'}
            </p>
            {planStatus ? (
              <p className="mt-1 text-[11px] leading-relaxed text-faint">
                {planStatus.usage.documentsGenerated}/{planStatus.usage.documentsLimit} documents ·{' '}
                {planStatus.usage.documentsRemaining} documents left ·{' '}
                {planStatus.usage.uploadsUsed}/{planStatus.usage.uploadsLimit} uploads ·{' '}
                {planStatus.usage.uploadsRemaining} left
              </p>
            ) : planError ? (
              <p className="mt-1 text-[11px] leading-relaxed text-amber-500">
                {planError}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-faint">Checking plan…</p>
            )}
          </div>
          <Link
            href="/community"
            className="mb-2 block rounded-lg px-3 py-2 text-sm text-mute transition-colors hover:bg-hover hover:text-ink"
          >
            My community
          </Link>
          <p
            className="truncate px-3 pb-1 text-xs font-medium text-faint"
            title={user.email}
          >
            {user.email}
          </p>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            <LogoutIcon />
            Log out
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 px-4 py-2 md:hidden">
          <div className="flex min-w-0 items-center gap-1">
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              className="rounded-lg p-2.5 text-mute hover:bg-hover hover:text-ink"
            >
              <MenuIcon />
            </button>
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <FileIcon className="h-4 w-4 shrink-0 text-mute" />
              <span className="truncate">Doc Batch Generator</span>
            </span>
          </div>
          <button
            onClick={reset}
            aria-label="New chat"
            className="shrink-0 rounded-lg p-2.5 text-mute hover:bg-hover hover:text-ink"
          >
            <NewChatIcon />
          </button>
        </div>

        {!started ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 pb-24">
            <h1 className="mb-8 text-center text-2xl font-medium sm:text-3xl">
              What&apos;s on your mind today?
            </h1>
            <div className="w-full max-w-3xl">{inputBar}</div>
            <p className="mt-3 max-w-xl text-center text-xs text-faint">
              Upload a .txt, .md, .csv, .json, .html or .docx sample — I&apos;ll generate
              10 similar Word documents you can download.
            </p>
            {hint && (
              <p className="mt-2 text-center text-xs text-amber-500">{hint}</p>
            )}
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-3xl bg-bubble px-5 py-3">
                    <button
                      onClick={downloadSample}
                      title="Download the sample file"
                      className="mb-1.5 inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-app px-3 py-1.5 text-xs text-mute transition-colors hover:text-ink"
                    >
                      <FileIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{sent!.fileName}</span>
                    </button>
                    {sent!.text && (
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-6">
                        {sent!.text}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  {status === 'planning' && (
                    <div className="flex items-center gap-3 text-[15px] text-mute">
                      <Spinner />
                      Analyzing your sample and planning 10 documents…
                    </div>
                  )}

                  {plans.length > 0 && (
                    <>
                      <p className="text-[15px] leading-6">
                        {status === 'writing'
                          ? `Writing your documents… ${results.length} of ${plans.length} done`
                          : status === 'done'
                            ? `Here are your ${results.length} document${results.length === 1 ? '' : 's'}. Preview them or download as Word files.`
                            : `Generation stopped early — ${results.length} of ${plans.length} documents were completed.`}
                      </p>

                      <div className="space-y-3">
                        {plans.map((plan, i) => {
                          const result = results.find((r) => r.index === i);
                          return (
                            <div
                              key={i}
                              className="rounded-2xl border border-line p-3.5"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="truncate font-medium">
                                    <span className="mr-2 text-faint">
                                      {i + 1}.
                                    </span>
                                    {result?.title || plan.title}
                                  </p>
                                  <p className="mt-0.5 line-clamp-2 text-sm text-faint">
                                    {plan.description}
                                  </p>
                                </div>
                                {result ? (
                                  <div className="flex shrink-0 items-center gap-2">
                                    <button
                                      onClick={() =>
                                        setPreviewIndex(previewIndex === i ? null : i)
                                      }
                                      className="rounded-full border border-line px-3 py-1 text-xs text-mute transition-colors hover:bg-hover hover:text-ink"
                                    >
                                      {previewIndex === i ? 'Hide' : 'Preview'}
                                    </button>
                                    <button
                                      onClick={() => downloadOne(result)}
                                      className="rounded-full bg-accent px-3.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                                    >
                                      Download .docx
                                    </button>
                                  </div>
                                ) : failed[i] ? (
                                  <span
                                    title={failed[i]}
                                    className="mt-1 shrink-0 text-xs text-red-500"
                                  >
                                    Failed
                                  </span>
                                ) : (
                                  <Spinner className="mt-1" />
                                )}
                              </div>
                              {result && previewIndex === i && (
                                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-code p-3 text-xs leading-relaxed text-mute">
                                  {result.content}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {(results.length > 0 || failedCount > 0) &&
                        (status === 'done' || status === 'error') && (
                          <div className="flex flex-wrap items-center gap-3">
                            {results.length > 0 && (
                              <button
                                onClick={downloadAll}
                                className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                              >
                                Download all {results.length} (.zip)
                              </button>
                            )}
                            {failedCount > 0 && (
                              <button
                                onClick={retryFailed}
                                className="rounded-full border border-accent px-5 py-2.5 text-sm font-medium text-accent-soft transition-colors hover:bg-accent-softbg"
                              >
                                Retry failed ({failedCount})
                              </button>
                            )}
                          </div>
                        )}
                    </>
                  )}

                  {error && (
                    <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                      {error}
                    </p>
                  )}

                  {status === 'error' && plans.length === 0 && sampleRef.current && (
                    <button
                      onClick={retryAll}
                      className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="mx-auto w-full max-w-3xl">
                {inputBar}
                {hint && (
                  <p className="mt-2 text-center text-xs text-amber-500">{hint}</p>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
