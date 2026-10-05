'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { insforge } from '@/lib/insforge';

type SharedDocument = {
  id: string;
  title: string;
  description: string;
  docx_key: string;
  shared_by?: string;
};

type Community = {
  community: { id: string; name: string; owner_id: string };
  role: 'owner' | 'member';
  members: { user_id: string; role: string; joined_at: string }[];
  invitations: { id: string; email: string; expires_at: string }[];
  myDocuments: SharedDocument[];
  sharedDocuments: SharedDocument[];
  messages: { id: string; sender_id: string; body: string; created_at: string }[];
};

type CommunityPayload = {
  communities: { id: string; name: string; isOwner: boolean }[];
  community: Community | null;
  canCreate: boolean;
};

type ActionResult = {
  communityId?: string;
  inviteUrl?: string;
  emailSent?: boolean;
  found?: boolean;
  warning?: string;
};

function requestHeaders(json = false) {
  const headers: Record<string, string> = {};
  const current = insforge.getHttpClient().getHeaders();
  if (current.Authorization) headers.Authorization = current.Authorization;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export default function CommunityPage() {
  const router = useRouter();
  const [data, setData] = useState<CommunityPayload | null>(null);
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [userSearchEmail, setUserSearchEmail] = useState('');
  const [foundUserEmail, setFoundUserEmail] = useState('');
  const [communityName, setCommunityName] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [selectedDocument, setSelectedDocument] = useState('');
  const [manualInviteUrl, setManualInviteUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inviteToken = useRef('');

  const load = useCallback(async (communityId?: string) => {
    setError('');
    try {
      const query = communityId ? `?communityId=${encodeURIComponent(communityId)}` : '';
      const response = await fetch(`/api/community${query}`, {
        headers: requestHeaders(),
        cache: 'no-store',
      });
      const result = (await response.json()) as CommunityPayload & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not load the community.');
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the community.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { data: result, error: authError } = await insforge.auth.getCurrentUser();
        if (authError) throw authError;
        setUserId(result?.user?.id ?? '');
        setUserEmail(result?.user?.email ?? '');
        if (result?.user) await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not verify your session.');
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  useEffect(() => {
    inviteToken.current = new URLSearchParams(window.location.search).get('invite') ?? '';
  }, []);

  useEffect(() => {
    if (!userId || !inviteToken.current) return;
    void (async () => {
      setBusy(true);
      setError('');
      try {
        const response = await fetch('/api/community', {
          method: 'POST',
          headers: requestHeaders(true),
          body: JSON.stringify({ action: 'accept', token: inviteToken.current }),
        });
        const result = (await response.json()) as { communityId?: string; error?: string };
        if (!response.ok) throw new Error(result.error || 'Could not accept the invitation.');
        window.history.replaceState({}, '', '/community');
        setNotice('You joined the community.');
        await load(result.communityId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not accept the invitation.');
      } finally {
        setBusy(false);
      }
    })();
  }, [load, userId]);

  useEffect(() => {
    const communityId = data?.community?.community.id;
    if (!communityId) return;

    const channel = `community:${communityId}`;
    const handleMessage = (payload: {
      id?: string;
      sender_id?: string;
      body?: string;
      created_at?: string;
    }) => {
      const { id, sender_id: senderId, body } = payload;
      if (!id || !senderId || typeof body !== 'string') return;
      setData((previous) => {
        if (!previous?.community || previous.community.community.id !== communityId) return previous;
        if (previous.community.messages.some((item) => item.id === id)) return previous;
        return {
          ...previous,
          community: {
            ...previous.community,
            messages: [
              ...previous.community.messages,
              {
                id,
                sender_id: senderId,
                body,
                created_at: payload.created_at ?? new Date().toISOString(),
              },
            ],
          },
        };
      });
    };
    insforge.realtime.on('new_message', handleMessage);
    void insforge.realtime.subscribe(channel).then((result) => {
      if (!result.ok) setError(result.error?.message ?? 'Could not connect to community chat.');
      else void load(communityId);
    });

    return () => {
      insforge.realtime.off('new_message', handleMessage);
      insforge.realtime.unsubscribe(channel);
    };
  }, [data?.community?.community.id, load]);

  const community = data?.community ?? null;
  const isOwner = community?.role === 'owner';

  async function act(action: string, extra: Record<string, string> = {}) {
    if (!community && action !== 'create') return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/community', {
        method: 'POST',
        headers: requestHeaders(true),
        body: JSON.stringify({
          action,
          ...(community ? { communityId: community.community.id } : {}),
          ...extra,
        }),
      });
      const result = (await response.json()) as ActionResult & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not complete the request.');
      if (result.communityId) {
        await load(result.communityId);
      } else {
        await load(community?.community.id);
      }
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete the request.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createCommunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await act('create', { name: communityName })) {
      setCommunityName('');
      setNotice('Your community is ready. Invite up to four people.');
    }
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await sendInvite(inviteEmail)) setInviteEmail('');
  }

  async function searchUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFoundUserEmail('');
    const result = await act('find-user', { email: userSearchEmail });
    if (!result) return;
    if (!result.found) {
      setNotice('No verified account was found for that email.');
      return;
    }
    setFoundUserEmail(userSearchEmail.trim().toLowerCase());
    setNotice('Verified account found. You can now send an invitation.');
  }

  async function sendInvite(email: string) {
    const result = await act('invite', { email });
    if (!result) return false;
    if (result.emailSent === false && result.inviteUrl) {
      setManualInviteUrl(result.inviteUrl);
      setError(result.warning ?? 'Email delivery failed. Copy the invitation link manually.');
      return true;
    }
    setManualInviteUrl('');
    setNotice('Invitation sent. The recipient must join with that verified email.');
    return true;
  }

  async function inviteFoundUser() {
    if (await sendInvite(foundUserEmail)) setFoundUserEmail('');
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = newMessage.trim();
    if (!body) return;
    if (await act('message', { body })) setNewMessage('');
  }

  async function shareDocument() {
    if (!selectedDocument) return;
    if (await act('share', { documentId: selectedDocument })) {
      setSelectedDocument('');
      setNotice('Document shared with this community.');
    }
  }

  async function downloadDocument(file: SharedDocument) {
    setError('');
    const { data: blob, error: downloadError } = await insforge.storage
      .from('documents')
      .download(file.docx_key);
    if (downloadError || !blob) {
      setError(downloadError?.message ?? 'Could not download this document.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${file.title.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'document'}.docx`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <main className="min-h-dvh bg-app p-8 text-center text-sm text-mute">Loading community…</main>;
  }

  if (!userId) {
    return (
      <main className="grid min-h-dvh place-items-center bg-app px-4 text-ink">
        <div className="max-w-md rounded-2xl border border-line bg-panel p-6 text-center">
          <h1 className="text-2xl font-semibold">Sign in to view your community</h1>
          <p className="mt-2 text-sm text-mute">Open the app and sign in, then return here.</p>
          <Link
            href="/app"
            onClick={(event) => {
              if (!inviteToken.current) return;
              event.preventDefault();
              router.push(`/app?communityInvite=${encodeURIComponent(inviteToken.current)}`);
            }}
            className="mt-5 inline-block rounded-xl bg-accent px-4 py-2 text-sm text-white"
          >
            Open app and sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-app text-ink">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Link href="/app" className="text-sm text-mute hover:text-ink">← Back to app</Link>
        <header className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Advanced plan</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your community</h1>
          <p className="mt-2 text-sm text-mute">Share selected Word documents and chat with up to four invited members.</p>
        </header>

        {error && <p role="alert" className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-500">{error}</p>}
        {notice && <p className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-500">{notice}</p>}

        {data?.canCreate && !data.communities.some((item) => item.isOwner) && (
          <section className="mt-8 rounded-2xl border border-line bg-panel p-6">
            <h2 className="text-lg font-medium">Create your five-person community</h2>
            <p className="mt-2 text-sm text-mute">You occupy one seat, leaving up to four invitees.</p>
            <form onSubmit={createCommunity} className="mt-5 flex flex-col gap-2 sm:flex-row">
              <input
                value={communityName}
                onChange={(event) => setCommunityName(event.target.value)}
                maxLength={80}
                required
                placeholder="Community name"
                className="min-w-0 flex-1 rounded-xl border border-line bg-app px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
              <button disabled={busy} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Creating…' : 'Create community'}
              </button>
            </form>
          </section>
        )}

        {!community ? (
          !data?.canCreate && (
            <section className="mt-8 rounded-2xl border border-line bg-panel p-6">
              <h2 className="text-lg font-medium">No active community found</h2>
              <p className="mt-2 text-sm text-mute">
                Community creation requires an active Advanced plan. An admin confirms payment and activates the plan.
              </p>
            </section>
          )
        ) : (
          <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <section className="space-y-5">
              {data && data.communities.length > 1 && (
                <label className="block text-xs text-mute">
                  Community
                  <select
                    value={community.community.id}
                    onChange={(event) => void load(event.target.value)}
                    className="mt-1 block w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-ink"
                  >
                    {data.communities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
              )}
              <section className="rounded-2xl border border-line bg-panel p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-medium">{community.community.name}</h2>
                    <p className="mt-1 text-xs text-mute">{community.members.length}/5 seats used</p>
                  </div>
                  <span className="rounded-full bg-hover px-2.5 py-1 text-xs text-mute">{isOwner ? 'Owner' : 'Member'}</span>
                </div>
                <ul className="mt-4 space-y-2">
                  {community.members.map((member) => (
                    <li key={member.user_id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-mute">
                        {member.user_id === userId ? `${userEmail} (you)` : `Member ${member.user_id.slice(0, 8)}`}
                        {member.role === 'owner' ? ' · owner' : ''}
                      </span>
                      {isOwner && member.user_id !== userId && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act('remove-member', { userId: member.user_id })}
                          className="text-amber-500 hover:text-amber-400"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {isOwner && (
                  <>
                    <form onSubmit={searchUser} className="mt-5 rounded-xl border border-line p-3">
                      <label htmlFor="community-user-search" className="text-xs font-medium text-ink">
                        Find an existing user
                      </label>
                      <p className="mt-1 text-xs text-mute">
                        Search by their verified account email. Only you can search for invitees.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <input
                          id="community-user-search"
                          type="email"
                          value={userSearchEmail}
                          onChange={(event) => {
                            setUserSearchEmail(event.target.value);
                            setFoundUserEmail('');
                          }}
                          required
                          placeholder="name@example.com"
                          className="min-w-0 flex-1 rounded-xl border border-line bg-app px-3 py-2.5 text-sm outline-none focus:border-accent"
                        />
                        <button
                          disabled={busy || community.members.length + community.invitations.length >= 5}
                          className="rounded-xl border border-line px-3 py-2.5 text-sm text-mute hover:bg-hover disabled:opacity-50"
                        >
                          Search
                        </button>
                      </div>
                      {foundUserEmail && (
                        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-hover p-3">
                          <span className="min-w-0 truncate text-xs text-mute">Verified user found: {foundUserEmail}</span>
                          <button
                            type="button"
                            disabled={busy || community.members.length + community.invitations.length >= 5}
                            onClick={() => void inviteFoundUser()}
                            className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                          >
                            Invite user
                          </button>
                        </div>
                      )}
                    </form>
                    <form onSubmit={inviteMember} className="mt-5 flex gap-2">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        required
                        placeholder="Invite by email"
                        className="min-w-0 flex-1 rounded-xl border border-line bg-app px-3 py-2.5 text-sm outline-none focus:border-accent"
                      />
                      <button disabled={busy || community.members.length + community.invitations.length >= 5} className="rounded-xl bg-accent px-3 py-2.5 text-sm text-white disabled:opacity-50">
                        Invite
                      </button>
                    </form>
                    {community.invitations.map((invite) => (
                      <div key={invite.id} className="mt-2 flex items-center justify-between gap-2 text-xs text-faint">
                        <span>Invitation pending for {invite.email} · expires {new Date(invite.expires_at).toLocaleDateString()}</span>
                        <button type="button" disabled={busy} onClick={() => void act('cancel-invitation', { invitationId: invite.id })} className="shrink-0 text-amber-500 hover:text-amber-400">
                          Cancel
                        </button>
                      </div>
                    ))}
                    {manualInviteUrl && (
                      <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                        <label className="text-xs font-medium text-amber-500" htmlFor="manual-invite-link">
                          One-use invitation link
                        </label>
                        <div className="mt-2 flex gap-2">
                          <input
                            id="manual-invite-link"
                            readOnly
                            value={manualInviteUrl}
                            className="min-w-0 flex-1 rounded-lg border border-line bg-app px-2 py-2 text-xs text-ink"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(manualInviteUrl)
                                .then(() => setNotice('Invitation link copied.'))
                                .catch(() => setError('Could not copy automatically; select and copy the link.'));
                            }}
                            className="rounded-lg border border-line px-3 py-2 text-xs text-mute hover:bg-hover"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>

              <section className="rounded-2xl border border-line bg-panel p-5">
                <h2 className="text-sm font-medium">Share one of your documents</h2>
                {community.myDocuments.length ? (
                  <div className="mt-3 flex gap-2">
                    <select
                      value={selectedDocument}
                      onChange={(event) => setSelectedDocument(event.target.value)}
                      className="min-w-0 flex-1 rounded-xl border border-line bg-app px-3 py-2.5 text-sm text-ink"
                    >
                      <option value="">Choose one of your generated documents</option>
                      {community.myDocuments.map((document) => (
                        <option key={document.id} value={document.id}>{document.title}</option>
                      ))}
                    </select>
                    <button type="button" disabled={!selectedDocument || busy} onClick={() => void shareDocument()} className="rounded-xl border border-line px-3 py-2 text-sm text-mute hover:bg-hover disabled:opacity-50">
                      Share
                    </button>
                  </div>
                ) : <p className="mt-2 text-xs text-faint">Generate a document first, then you can share it here.</p>}
              </section>

              <section className="rounded-2xl border border-line bg-panel p-5">
                <h2 className="text-sm font-medium">Shared documents</h2>
                {community.sharedDocuments.length ? (
                  <ul className="mt-3 divide-y divide-divider">
                    {community.sharedDocuments.map((document) => (
                      <li key={document.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{document.title}</p>
                          {document.description && <p className="mt-1 line-clamp-2 text-xs text-mute">{document.description}</p>}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button type="button" onClick={() => void downloadDocument(document)} className="rounded-lg border border-line px-3 py-2 text-xs text-mute hover:bg-hover">Download</button>
                          {(isOwner || document.shared_by === userId) && <button type="button" disabled={busy} onClick={() => void act('unshare', { documentId: document.id })} className="rounded-lg border border-line px-3 py-2 text-xs text-amber-500 hover:bg-hover">Unshare</button>}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-xs text-faint">No documents have been shared yet.</p>}
              </section>
            </section>

            <section className="flex min-h-[34rem] flex-col rounded-2xl border border-line bg-panel">
              <div className="border-b border-divider p-5">
                <h2 className="text-lg font-medium">Community chat</h2>
                <p className="mt-1 text-xs text-mute">Messages are visible to active community members.</p>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {community.messages.map((item) => (
                  <article key={item.id} className={`max-w-[90%] rounded-2xl px-3 py-2 ${item.sender_id === userId ? 'ml-auto bg-accent text-white' : 'bg-app text-ink'}`}>
                    <p className="whitespace-pre-wrap break-words text-sm">{item.body}</p>
                    <p className={`mt-1 text-[10px] ${item.sender_id === userId ? 'text-white/70' : 'text-faint'}`}>
                      {item.sender_id === userId ? 'You' : 'Member'} · {new Date(item.created_at).toLocaleString()}
                    </p>
                  </article>
                ))}
                {community.messages.length === 0 && <p className="py-10 text-center text-sm text-faint">Start the conversation.</p>}
              </div>
              <form onSubmit={sendMessage} className="flex gap-2 border-t border-divider p-4">
                <textarea
                  value={newMessage}
                  onChange={(event) => setNewMessage(event.target.value)}
                  maxLength={4000}
                  rows={2}
                  placeholder="Write a message…"
                  className="min-w-0 flex-1 resize-y rounded-xl border border-line bg-app px-3 py-2.5 text-sm outline-none focus:border-accent"
                />
                <button disabled={busy || !newMessage.trim()} className="self-end rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
                  Send
                </button>
              </form>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
