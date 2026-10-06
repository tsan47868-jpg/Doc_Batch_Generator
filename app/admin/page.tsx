'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { insforge } from '@/lib/insforge';

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  access: {
    plan_id: 'basic' | 'advanced';
    status: 'active' | 'revoked';
    starts_at: string;
    expires_at: string;
  } | null;
  usage: {
    documents_generated: number;
    uploads_used: number;
  };
  limits: { documents: number; uploads: number };
  geminiUsage: {
    requests: number;
    promptTokens: number;
    candidateTokens: number;
    totalTokens: number;
    failed: number;
  };
};

type UserActivity = {
  id: string;
  plan_id: 'basic' | 'advanced';
  instructions: string;
  request_kind: 'generate' | 'retry';
  status: 'processing' | 'completed' | 'partial' | 'failed';
  documents_requested: number;
  documents_succeeded: number;
  documents_failed: number;
  created_at: string;
  gemini: {
    calls: number;
    promptTokens: number;
    candidateTokens: number;
    totalTokens: number;
    failedCalls: number;
  };
  documents: {
    doc_index: number;
    title: string;
    description: string;
    status: 'generated' | 'failed';
  }[];
};

type UsersResponse = {
  users: AdminUser[];
  pagination: { offset: number; limit: number; total: number };
};

type PaymentRequest = {
  id: string;
  user_id: string;
  user_email: string;
  plan_id: 'basic' | 'advanced';
  mpesa_reference: string;
  created_at: string;
};

function authHeaders() {
  const headers = insforge.getHttpClient().getHeaders();
  const result: Record<string, string> = {};
  if (headers.Authorization) result.Authorization = headers.Authorization;
  return result;
}

function isActive(user: AdminUser) {
  return Boolean(
    user.access?.status === 'active' &&
      new Date(user.access.expires_at).getTime() > Date.now() &&
      new Date(user.access.starts_at).getTime() <= Date.now(),
  );
}

function showAdminGateForResponse(
  response: Response,
  setUnlocked: (unlocked: boolean) => void,
  setGateError: (error: string) => void,
  error?: string,
) {
  if (response.status !== 401 && response.status !== 429) return;
  setUnlocked(false);
  setGateError(error || 'Unlock the admin page to continue.');
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [openActivity, setOpenActivity] = useState<string | null>(null);
  const [activity, setActivity] = useState<Record<string, UserActivity[]>>({});
  const [busyActivity, setBusyActivity] = useState<string | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [busyPaymentRequest, setBusyPaymentRequest] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<{ email: string; code: string } | null>(null);
  const [adminGateChecking, setAdminGateChecking] = useState(true);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminGateError, setAdminGateError] = useState('');
  const [adminGateBusy, setAdminGateBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pageSize = 100;

  const loadUsers = useCallback(async (term: string, pageOffset: number) => {
    setLoading(true);
    setError('');
    try {
      const { data: session } = await insforge.auth.getCurrentUser();
      if (!session?.user) {
        setError('Sign in with the admin account to manage plan access.');
        setUsers([]);
        return;
      }
      const params = new URLSearchParams({ offset: String(pageOffset) });
      if (term) params.set('q', term);
      const response = await fetch(`/api/admin/users?${params}`, {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const result = (await response.json()) as UsersResponse & { error?: string };
      showAdminGateForResponse(response, setAdminUnlocked, setAdminGateError, result.error);
      if (!response.ok) throw new Error(result.error || 'Could not load user accounts.');
      setUsers(result.users);
      setTotal(result.pagination.total);
      setOffset(result.pagination.offset);
    } catch (cause) {
      setUsers([]);
      setError(cause instanceof Error ? cause.message : 'Could not load user accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPaymentRequests = useCallback(async () => {
    setLoadingPayments(true);
    try {
      const response = await fetch('/api/admin/payments', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const result = (await response.json()) as {
        requests?: PaymentRequest[];
        error?: string;
      };
      showAdminGateForResponse(response, setAdminUnlocked, setAdminGateError, result.error);
      if (!response.ok) throw new Error(result.error || 'Could not load payment requests.');
      setPaymentRequests(result.requests ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load payment requests.');
      setPaymentRequests([]);
    } finally {
      setLoadingPayments(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkAdminSession() {
      try {
        const response = await fetch('/api/admin/session', {
          headers: authHeaders(),
          cache: 'no-store',
        });
        const result = (await response.json()) as {
          authenticated?: boolean;
          error?: string;
        };
        if (!response.ok) {
          if (!cancelled) setAdminGateError(result.error || 'Enter the admin page password to continue.');
          return;
        }
        if (!cancelled) setAdminUnlocked(Boolean(result.authenticated));
      } catch (cause) {
        if (!cancelled) {
          setAdminGateError(cause instanceof Error ? cause.message : 'Could not check admin page access.');
        }
      } finally {
        if (!cancelled) setAdminGateChecking(false);
      }
    }
    void checkAdminSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!adminUnlocked) return;
    const timer = window.setTimeout(() => {
      void loadUsers(query, offset);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [adminUnlocked, loadUsers, query, offset]);

  useEffect(() => {
    if (!adminUnlocked) return;
    const timer = window.setTimeout(() => void loadPaymentRequests(), 0);
    return () => window.clearTimeout(timer);
  }, [adminUnlocked, loadPaymentRequests]);

  async function unlockAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdminGateBusy(true);
    setAdminGateError('');
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not unlock admin page.');
      setAdminPassword('');
      setAdminUnlocked(true);
    } catch (cause) {
      setAdminGateError(cause instanceof Error ? cause.message : 'Could not unlock admin page.');
    } finally {
      setAdminGateBusy(false);
    }
  }

  async function lockAdmin() {
    setAdminUnlocked(false);
    setAdminPassword('');
    setAdminGateError('');
    try {
      const response = await fetch('/api/admin/session', { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not lock the admin session on the server.');
    } catch (cause) {
      setAdminGateError(cause instanceof Error ? cause.message : 'Could not lock the admin session.');
    }
  }

  async function searchUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setQuery(search.trim());
  }

  async function updateAccess(
    user: AdminUser,
    action: 'grant' | 'revoke',
    planId: 'basic' | 'advanced' = 'basic',
  ) {
    setBusyUser(user.id);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, action, planId }),
      });
      const result = (await response.json()) as { error?: string };
      showAdminGateForResponse(response, setAdminUnlocked, setAdminGateError, result.error);
      if (!response.ok) throw new Error(result.error || 'Could not update plan access.');
      setMessage(
        action === 'grant'
          ? `One month of ${planId === 'advanced' ? 'Advanced' : 'Basic'} access granted to ${user.email}.`
          : `Plan access revoked for ${user.email}.`,
      );
      await loadUsers(query, offset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update plan access.');
    } finally {
      setBusyUser(null);
    }
  }

  async function toggleActivity(userId: string) {
    if (openActivity === userId) {
      setOpenActivity(null);
      return;
    }
    setOpenActivity(userId);
    if (activity[userId]) return;
    setBusyActivity(userId);
    try {
      const response = await fetch(
        `/api/admin/activity?userId=${encodeURIComponent(userId)}`,
        { headers: authHeaders(), cache: 'no-store' },
      );
      const result = (await response.json()) as {
        activity?: UserActivity[];
        error?: string;
      };
      showAdminGateForResponse(response, setAdminUnlocked, setAdminGateError, result.error);
      if (!response.ok) throw new Error(result.error || 'Could not load request history.');
      setActivity((previous) => ({ ...previous, [userId]: result.activity ?? [] }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load request history.');
      setOpenActivity(null);
    } finally {
      setBusyActivity(null);
    }
  }

  async function reviewPayment(request: PaymentRequest, action: 'grant' | 'issue_code' | 'reject') {
    setBusyPaymentRequest(request.id);
    setError('');
    setMessage('');
    setIssuedCode(null);
    try {
      const response = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.id, action }),
      });
      const result = (await response.json()) as {
        error?: string;
        code?: string | null;
        message?: string;
      };
      showAdminGateForResponse(response, setAdminUnlocked, setAdminGateError, result.error);
      if (!response.ok) throw new Error(result.error || 'Could not review payment.');
      setMessage(result.message || 'Payment request processed.');
      if (result.code) setIssuedCode({ email: request.user_email, code: result.code });
      await Promise.all([loadPaymentRequests(), loadUsers(query, offset)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not review payment.');
    } finally {
      setBusyPaymentRequest(null);
    }
  }

  if (adminGateChecking) {
    return (
      <main className="grid min-h-dvh place-items-center bg-app px-4 text-ink">
        <p role="status" className="text-sm text-mute">Checking admin access…</p>
      </main>
    );
  }

  if (!adminUnlocked) {
    return (
      <main className="grid min-h-dvh place-items-center bg-app px-4 py-10 text-ink">
        <section className="w-full max-w-md rounded-3xl border border-line bg-panel p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Protected admin area</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Enter admin password</h1>
          <p className="mt-2 text-sm leading-relaxed text-mute">
            Sign in with the verified admin account, then enter the separate admin page password. Three incorrect passwords block this IP address for 24 hours.
          </p>
          <form onSubmit={unlockAdmin} className="mt-6 space-y-3">
            <label htmlFor="admin-page-password" className="block text-sm font-medium">Admin page password</label>
            <input
              id="admin-page-password"
              type="password"
              required
              maxLength={256}
              autoComplete="current-password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              className="w-full rounded-xl border border-line bg-app px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />
            {adminGateError && <p role="alert" className="text-sm text-amber-500">{adminGateError}</p>}
            <button
              type="submit"
              disabled={adminGateBusy}
              className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adminGateBusy ? 'Checking…' : 'Unlock admin page'}
            </button>
          </form>
          <Link href="/app" className="mt-4 inline-block text-sm text-mute underline underline-offset-4 hover:text-ink">
            Back to app
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-app text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
        <Link href="/app" className="text-sm text-mute transition-colors hover:text-ink">
          ← Back to app
        </Link>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Plans & usage</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mute">
              Review M-Pesa receipts and either activate the requested plan or generate a one-time code to send manually. Grants extend an active plan by one month. Request logs include user instructions and generated document titles; document contents are not shown here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void lockAdmin()}
            className="rounded-lg border border-line px-3 py-2 text-xs text-mute hover:bg-hover"
          >
            Lock admin page
          </button>
        </div>

        <section className="mt-8 rounded-2xl border border-line bg-panel p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Payment requests</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-mute">
                When a user sends money to your M-Pesa number, they submit the transaction code shown in their confirmation message here. Check that code and amount in M-Pesa on your phone or laptop. If the payment matches, choose Approve &amp; activate to unlock their account, or generate a code and send it to them manually.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadPaymentRequests()}
              disabled={loadingPayments}
              className="rounded-lg border border-line px-3 py-2 text-xs text-mute hover:bg-hover disabled:opacity-50"
            >
              {loadingPayments ? 'Refreshing…' : 'Refresh requests'}
            </button>
          </div>

          {issuedCode && (
            <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <p className="text-sm font-medium text-emerald-500">One-time code for {issuedCode.email}</p>
              <p className="mt-1 text-xs text-mute">Copy and send this code manually. It is account-bound, valid for 30 days, and shown only once.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="break-all rounded-lg border border-line bg-app px-3 py-2 text-sm font-semibold tracking-wider text-ink">{issuedCode.code}</code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(issuedCode.code).then(
                      () => setMessage(`Code copied. Send it to ${issuedCode.email}.`),
                      () => setError('Could not copy the code automatically. Select and copy it manually.'),
                    );
                  }}
                  className="rounded-lg border border-line px-3 py-2 text-xs text-mute hover:bg-hover"
                >
                  Copy code
                </button>
              </div>
            </div>
          )}

          {loadingPayments ? (
            <p className="py-8 text-center text-sm text-mute">Loading payment requests…</p>
          ) : paymentRequests.length === 0 ? (
            <p className="py-8 text-center text-sm text-mute">No payment requests are waiting for review.</p>
          ) : (
            <ul className="mt-4 divide-y divide-divider">
              {paymentRequests.map((request) => (
                <li key={request.id} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{request.user_email}</p>
                    <p className="mt-1 text-xs text-mute">
                      {request.plan_id === 'advanced' ? 'Advanced · KES 900' : 'Basic · KES 200'}
                      {' · '}Transaction code: <span className="font-semibold tracking-wide text-ink">{request.mpesa_reference}</span>
                    </p>
                    <time className="mt-1 block text-xs text-faint" dateTime={request.created_at}>
                      Submitted {new Date(request.created_at).toLocaleString()}
                    </time>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyPaymentRequest !== null}
                      onClick={() => void reviewPayment(request, 'grant')}
                      className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      {busyPaymentRequest === request.id ? 'Processing…' : 'Approve & activate'}
                    </button>
                    <button
                      type="button"
                      disabled={busyPaymentRequest !== null}
                      onClick={() => void reviewPayment(request, 'issue_code')}
                      className="rounded-lg border border-accent px-3 py-2 text-xs font-medium text-accent hover:bg-hover disabled:opacity-50"
                    >
                      Generate code to send
                    </button>
                    <button
                      type="button"
                      disabled={busyPaymentRequest !== null}
                      onClick={() => void reviewPayment(request, 'reject')}
                      className="rounded-lg border border-line px-3 py-2 text-xs text-mute hover:bg-hover disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8 rounded-2xl border border-line bg-panel p-4 sm:p-5">
          <form onSubmit={searchUsers} className="flex flex-col gap-2 sm:flex-row">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by user name or email"
              aria-label="Search users"
              className="min-w-0 flex-1 rounded-xl border border-line bg-app px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Search users
            </button>
          </form>

          {message && <p className="mt-4 text-sm text-emerald-500">{message}</p>}
          {error && <p role="alert" className="mt-4 text-sm text-amber-500">{error}</p>}

          <div className="mt-5 flex items-center justify-between gap-3 border-b border-divider pb-3 text-xs text-faint">
            <span>{total} account{total === 1 ? '' : 's'}</span>
            <span>Basic KES 200 · Advanced KES 900 · Usage resets monthly (UTC)</span>
          </div>

          {loading ? (
            <p className="py-10 text-center text-sm text-mute">Loading accounts…</p>
          ) : users.length === 0 ? (
            <p className="py-10 text-center text-sm text-mute">No users found.</p>
          ) : (
            <ul className="divide-y divide-divider">
              {users.map((user) => {
                const active = isActive(user);
                return (
                  <li key={user.id} className="py-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {user.name || user.email}
                        </p>
                        <p className="truncate text-xs text-mute">{user.email}</p>
                        <p className="mt-1 text-xs text-faint">
                          {user.emailVerified ? 'Verified' : 'Email not verified'}
                          {' · '}
                          {user.usage.documents_generated}/{user.limits.documents} documents (
                          {Math.max(0, user.limits.documents - user.usage.documents_generated)} left)
                          {' · '}
                          {user.usage.uploads_used}/{user.limits.uploads} uploads (
                          {Math.max(0, user.limits.uploads - user.usage.uploads_used)} left)
                        </p>
                        <p className="mt-1 text-xs text-faint">
                          Gemini this month: {user.geminiUsage.requests} calls ·{' '}
                          {user.geminiUsage.totalTokens.toLocaleString()} tokens
                          {user.geminiUsage.failed
                            ? ` · ${user.geminiUsage.failed} unsuccessful`
                            : ''}
                        </p>
                        {user.access && (
                          <p className="mt-1 text-xs text-faint">
                            {active
                              ? `Access until ${new Date(user.access.expires_at).toLocaleDateString()}`
                              : `Access ${user.access.status === 'revoked' ? 'revoked' : 'expired'}`}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => void toggleActivity(user.id)}
                          className="mt-2 text-xs font-medium text-accent-soft hover:text-accent"
                        >
                          {busyActivity === user.id
                            ? 'Loading history…'
                            : openActivity === user.id
                              ? 'Hide request history'
                              : 'View request history'}
                        </button>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            active
                              ? 'bg-emerald-500/10 text-emerald-500'
                              : 'bg-hover text-faint'
                          }`}
                        >
                          {active
                            ? `${user.access?.plan_id === 'advanced' ? 'Advanced' : 'Basic'} active`
                            : 'No active access'}
                        </span>
                        <button
                          type="button"
                          disabled={!user.emailVerified || busyUser === user.id}
                          title={!user.emailVerified ? 'The user must verify their email first.' : undefined}
                          onClick={() => void updateAccess(user, 'grant', 'basic')}
                          className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busyUser === user.id ? 'Saving…' : `${active ? 'Grant/extend' : 'Grant'} Basic`}
                        </button>
                        <button
                          type="button"
                          disabled={!user.emailVerified || busyUser === user.id}
                          title={!user.emailVerified ? 'The user must verify their email first.' : undefined}
                          onClick={() => void updateAccess(user, 'grant', 'advanced')}
                          className="rounded-lg border border-accent px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busyUser === user.id ? 'Saving…' : `${active ? 'Grant/extend' : 'Grant'} Advanced`}
                        </button>
                        {active && (
                          <button
                            type="button"
                            disabled={busyUser === user.id}
                            onClick={() => void updateAccess(user, 'revoke')}
                            className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-mute transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                    {openActivity === user.id && (
                      <div className="mt-4 space-y-3 rounded-xl border border-line bg-app p-3">
                        {(activity[user.id] ?? []).length === 0 ? (
                          <p className="text-xs text-faint">
                            {busyActivity === user.id ? 'Loading request history…' : 'No generation requests recorded.'}
                          </p>
                        ) : (
                          activity[user.id].map((entry) => (
                            <article key={entry.id} className="border-b border-divider pb-3 last:border-0 last:pb-0">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-medium text-ink">
                                  {entry.plan_id === 'advanced' ? 'Advanced' : 'Basic'} · {entry.request_kind} · {entry.status}
                                </p>
                                <time className="text-[11px] text-faint">
                                  {new Date(entry.created_at).toLocaleString()}
                                </time>
                              </div>
                              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-mute">
                                {entry.instructions || 'No extra instructions entered.'}
                              </p>
                              <p className="mt-1 text-[11px] text-faint">
                                Docs: {entry.documents_succeeded}/{entry.documents_requested} succeeded, {entry.documents_failed} failed
                                {' · '}Gemini: {entry.gemini.calls} calls, {entry.gemini.totalTokens.toLocaleString()} tokens
                                {entry.gemini.failedCalls ? `, ${entry.gemini.failedCalls} unsuccessful` : ''}
                              </p>
                              {entry.documents.length > 0 && (
                                <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] text-mute">
                                  {entry.documents.map((document) => (
                                    <li key={`${entry.id}-${document.doc_index}`}>
                                      {document.title} ({document.status})
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </article>
                          ))
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-divider pt-3">
            <button
              type="button"
              disabled={loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - pageSize))}
              className="rounded-lg border border-line px-3 py-2 text-xs text-mute hover:bg-hover disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-faint">
              {total === 0 ? 0 : offset + 1}–{Math.min(offset + pageSize, total)} of {total}
            </span>
            <button
              type="button"
              disabled={loading || offset + pageSize >= total}
              onClick={() => setOffset(offset + pageSize)}
              className="rounded-lg border border-line px-3 py-2 text-xs text-mute hover:bg-hover disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
