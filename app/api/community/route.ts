import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateRequest,
  getAdminBackendClient,
  getUserPlanState,
} from '@/lib/plan-access';

export const runtime = 'nodejs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITE_PATTERN = /^[0-9a-f]{64}$/i;

type CommunityRow = {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
};

function hashInvite(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

async function activeAdvancedOwner(admin: ReturnType<typeof getAdminBackendClient>, ownerId: string) {
  const { data, error } = await admin.database
    .from('user_plan_access')
    .select('plan_id, status, starts_at, expires_at')
    .eq('user_id', ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const now = Date.now();
  return Boolean(
    data?.plan_id === 'advanced' &&
      data.status === 'active' &&
      new Date(data.starts_at).getTime() <= now &&
      new Date(data.expires_at).getTime() > now,
  );
}

async function communityAccess(
  admin: ReturnType<typeof getAdminBackendClient>,
  communityId: string,
  userId: string,
) {
  const [{ data: community, error: communityError }, { data: membership, error: memberError }] =
    await Promise.all([
      admin.database.from('communities').select('id, owner_id, name, created_at').eq('id', communityId).maybeSingle(),
      admin.database.from('community_members').select('community_id, user_id, role').eq('community_id', communityId).eq('user_id', userId).maybeSingle(),
    ]);
  if (communityError) throw new Error(communityError.message);
  if (memberError) throw new Error(memberError.message);
  if (!community || !membership) return null;
  if (!(await activeAdvancedOwner(admin, community.owner_id))) return null;
  return { community: community as CommunityRow, membership };
}

async function readCommunity(
  admin: ReturnType<typeof getAdminBackendClient>,
  community: CommunityRow,
  userId: string,
  isOwner: boolean,
) {
  const [
    { data: members, error: membersError },
    { data: shares, error: sharesError },
    { data: messages, error: messagesError },
    { data: invitations, error: invitationsError },
    { data: myDocuments, error: myDocumentsError },
  ] = await Promise.all([
    admin.database.from('community_members').select('user_id, role, joined_at').eq('community_id', community.id).order('joined_at', { ascending: true }),
    admin.database.from('community_shared_documents').select('document_id, shared_by, created_at').eq('community_id', community.id).order('created_at', { ascending: false }),
    admin.database.from('community_messages').select('id, sender_id, body, created_at').eq('community_id', community.id).order('created_at', { ascending: false }).limit(100),
    isOwner
      ? admin.database.from('community_invitations').select('id, email, expires_at, accepted_at, created_at').eq('community_id', community.id).is('accepted_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    admin.database.from('documents').select('id, title, description, docx_key, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
  ]);
  if (membersError) throw new Error(membersError.message);
  if (sharesError) throw new Error(sharesError.message);
  if (messagesError) throw new Error(messagesError.message);
  if (invitationsError) throw new Error(invitationsError.message);
  if (myDocumentsError) throw new Error(myDocumentsError.message);

  const documentIds = (shares ?? []).map((share) => share.document_id);
  let sharedDocuments: Array<{
    id: string;
    title: string;
    description: string;
    docx_key: string;
    created_at: string;
    shared_at: string;
    shared_by: string;
  }> = [];
  if (documentIds.length) {
    const { data, error } = await admin.database
      .from('documents')
      .select('id, title, description, docx_key, created_at')
      .in('id', documentIds);
    if (error) throw new Error(error.message);
    const shareTimes = new Map((shares ?? []).map((share) => [share.document_id, share.created_at]));
    sharedDocuments = (data ?? []).map((document) => ({
      ...document,
      shared_at: shareTimes.get(document.id) ?? document.created_at,
      shared_by: (shares ?? []).find((share) => share.document_id === document.id)?.shared_by ?? '',
    }));
  }

  return {
    community,
    role: isOwner ? 'owner' : 'member',
    members: members ?? [],
    invitations: invitations ?? [],
    myDocuments: myDocuments ?? [],
    sharedDocuments,
    messages: [...(messages ?? [])].reverse(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.user) return auth.response;
    const admin = getAdminBackendClient();
    const { data: memberships, error } = await admin.database
      .from('community_members')
      .select('community_id, role')
      .eq('user_id', auth.user.id);
    if (error) throw new Error(error.message);

    const communityIds = (memberships ?? []).map((item) => item.community_id);
    const ownerPlan = await getUserPlanState(auth.user.id);
    if (!communityIds.length) {
      return NextResponse.json({
        communities: [],
        community: null,
        canCreate: ownerPlan.active && ownerPlan.plan === 'advanced',
      });
    }

    const { data: rows, error: communitiesError } = await admin.database
      .from('communities')
      .select('id, owner_id, name, created_at')
      .in('id', communityIds)
      .order('created_at', { ascending: false });
    if (communitiesError) throw new Error(communitiesError.message);

    const activeRows: CommunityRow[] = [];
    for (const community of rows ?? []) {
      if (await activeAdvancedOwner(admin, community.owner_id)) {
        activeRows.push(community as CommunityRow);
      }
    }

    const requestedId = request.nextUrl.searchParams.get('communityId');
    const selected =
      activeRows.find((community) => community.id === requestedId) ??
      activeRows[0] ??
      null;
    return NextResponse.json({
      communities: activeRows.map(({ id, name, owner_id }) => ({
        id,
        name,
        isOwner: owner_id === auth.user.id,
      })),
      canCreate: ownerPlan.active && ownerPlan.plan === 'advanced',
      community: selected
        ? await readCommunity(
            admin,
            selected,
            auth.user.id,
            selected.owner_id === auth.user.id,
          )
        : null,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Community lookup failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load your community.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.user) return auth.response;
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    const action = body.action;
    const admin = getAdminBackendClient();

    if (action === 'accept') {
      if (!auth.user.emailVerified || !auth.user.email) {
        return NextResponse.json({ error: 'Verify your email before accepting an invitation.' }, { status: 403 });
      }
      if (typeof body.token !== 'string' || !INVITE_PATTERN.test(body.token)) {
        return NextResponse.json({ error: 'This invitation link is invalid.' }, { status: 400 });
      }
      const { data, error } = await admin.database.rpc('accept_community_invitation', {
        invitation_token_hash: hashInvite(body.token),
        accepting_user: auth.user.id,
        accepting_email: auth.user.email,
      });
      if (error) {
        return NextResponse.json(
          { error: error.message.includes('COMMUNITY_SEAT_LIMIT_REACHED')
              ? 'This community has no seats left.'
              : 'This invitation is expired, already used, or belongs to another email.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ communityId: data });
    }

    if (action === 'create') {
      const plan = await getUserPlanState(auth.user.id);
      if (!plan.active || plan.plan !== 'advanced') {
        return NextResponse.json({ error: 'An active Advanced plan is required to create a community.' }, { status: 403 });
      }
      const name = typeof body.name === 'string'
        ? body.name.trim().replace(/\s+/g, ' ').slice(0, 80)
        : '';
      if (!name) return NextResponse.json({ error: 'Enter a community name.' }, { status: 400 });
      const { data: existing, error: existingError } = await admin.database
        .from('communities')
        .select('id')
        .eq('owner_id', auth.user.id)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (existing) return NextResponse.json({ error: 'You already created a community.' }, { status: 409 });
      const { data, error } = await admin.database
        .from('communities')
        .insert([{ owner_id: auth.user.id, name }])
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ communityId: data.id });
    }

    if (action === 'find-user') {
      const communityId = typeof body.communityId === 'string' ? body.communityId : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!UUID_PATTERN.test(communityId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
      }
      const access = await communityAccess(admin, communityId, auth.user.id);
      if (!access || access.membership.role !== 'owner') {
        return NextResponse.json({ error: 'Only the community owner can search for users to invite.' }, { status: 403 });
      }
      if (email === auth.user.email?.trim().toLowerCase()) {
        return NextResponse.json({ error: 'You already occupy the owner seat.' }, { status: 400 });
      }
      const { data: found, error } = await admin.database.rpc('find_verified_community_user', {
        target_email: email,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ found: found === true });
    }

    if (action === 'invite') {
      const communityId = typeof body.communityId === 'string' ? body.communityId : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!UUID_PATTERN.test(communityId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
      }
      const access = await communityAccess(admin, communityId, auth.user.id);
      if (!access || access.membership.role !== 'owner') {
        return NextResponse.json({ error: 'Only the community owner can invite people.' }, { status: 403 });
      }
      if (email === auth.user.email?.trim().toLowerCase()) {
        return NextResponse.json({ error: 'You already occupy the owner seat.' }, { status: 400 });
      }
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || request.nextUrl.origin;
      const inviteUrl = new URL('/community', siteUrl);
      if (inviteUrl.protocol !== 'https:' && inviteUrl.hostname !== 'localhost') {
        return NextResponse.json({ error: 'Community invitation links require an HTTPS site URL.' }, { status: 500 });
      }
      inviteUrl.searchParams.set('invite', token);
      const { error: inviteError } = await admin.database
        .from('community_invitations')
        .insert([{
          community_id: communityId,
          email,
          token_hash: hashInvite(token),
          invited_by: auth.user.id,
          expires_at: expiresAt,
        }]);
      if (inviteError) {
        const message = inviteError.message.includes('COMMUNITY_SEAT_LIMIT_REACHED')
          ? 'All five community seats are in use or reserved by invitations.'
          : inviteError.message.includes('COMMUNITY_INVITATION_ALREADY_EXISTS')
            ? 'That email is already a member or has a pending invitation.'
            : inviteError.message;
        return NextResponse.json({ error: message }, { status: 409 });
      }

      const safeEmail = escapeHtml(email);
      const safeCommunityName = escapeHtml(access.community.name);
      const { error: emailError } = await admin.emails.send({
        to: email,
        subject: `Invitation to ${access.community.name}`,
        html: `<p>You were invited to join <strong>${safeCommunityName}</strong> on Doc Batch Generator.</p><p><a href="${inviteUrl.toString()}">Accept invitation</a></p><p>This invitation expires in seven days and is bound to ${safeEmail}.</p>`,
      });
      if (emailError) {
        console.error('Community invitation email delivery failed:', emailError);
        return NextResponse.json({
          success: true,
          emailSent: false,
          inviteUrl: inviteUrl.toString(),
          warning: 'The invitation is reserved, but email delivery failed. Copy this one-use link and send it directly to the invited email address.',
        });
      }
      return NextResponse.json({ success: true, emailSent: true });
    }

    const communityId = typeof body.communityId === 'string' ? body.communityId : '';
    if (!UUID_PATTERN.test(communityId)) {
      return NextResponse.json({ error: 'Choose a valid community.' }, { status: 400 });
    }
    const access = await communityAccess(admin, communityId, auth.user.id);
    if (!access) return NextResponse.json({ error: 'You do not have access to this active community.' }, { status: 403 });

    if (action === 'cancel-invitation') {
      if (access.membership.role !== 'owner') {
        return NextResponse.json({ error: 'Only the community owner can cancel invitations.' }, { status: 403 });
      }
      const invitationId = typeof body.invitationId === 'string' ? body.invitationId : '';
      if (!UUID_PATTERN.test(invitationId)) {
        return NextResponse.json({ error: 'Choose a valid pending invitation.' }, { status: 400 });
      }
      const { error } = await admin.database
        .from('community_invitations')
        .delete()
        .eq('id', invitationId)
        .eq('community_id', communityId)
        .is('accepted_at', null);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true });
    }

    if (action === 'share') {
      const documentId = typeof body.documentId === 'string' ? body.documentId : '';
      if (!UUID_PATTERN.test(documentId)) {
        return NextResponse.json({ error: 'Choose a valid document.' }, { status: 400 });
      }
      const { data: document, error: documentError } = await admin.database
        .from('documents')
        .select('id')
        .eq('id', documentId)
        .eq('user_id', auth.user.id)
        .maybeSingle();
      if (documentError) throw new Error(documentError.message);
      if (!document) return NextResponse.json({ error: 'You can only share documents from your own account.' }, { status: 403 });
      const { error } = await admin.database.from('community_shared_documents').insert([{
        community_id: communityId,
        document_id: documentId,
        shared_by: auth.user.id,
      }]);
      if (error) return NextResponse.json({ error: error.message }, { status: 409 });
      return NextResponse.json({ success: true });
    }

    if (action === 'unshare') {
      const documentId = typeof body.documentId === 'string' ? body.documentId : '';
      let deleteQuery = admin.database
        .from('community_shared_documents')
        .delete()
        .eq('community_id', communityId)
        .eq('document_id', documentId);
      if (access.membership.role !== 'owner') {
        deleteQuery = deleteQuery.eq('shared_by', auth.user.id);
      }
      const { error } = await deleteQuery;
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true });
    }

    if (action === 'remove-member') {
      if (access.membership.role !== 'owner') {
        return NextResponse.json({ error: 'Only the community owner can remove members.' }, { status: 403 });
      }
      const userId = typeof body.userId === 'string' ? body.userId : '';
      if (!UUID_PATTERN.test(userId) || userId === access.community.owner_id) {
        return NextResponse.json({ error: 'Choose a valid community member.' }, { status: 400 });
      }
      const { error } = await admin.database
        .from('community_members')
        .delete()
        .eq('community_id', communityId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true });
    }

    if (action === 'message') {
      const message = typeof body.body === 'string' ? body.body.trim() : '';
      if (!message || message.length > 4000) {
        return NextResponse.json({ error: 'Messages must be between 1 and 4,000 characters.' }, { status: 400 });
      }
      const { error } = await admin.database.from('community_messages').insert([{
        community_id: communityId,
        sender_id: auth.user.id,
        body: message,
      }]);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown community action.' }, { status: 400 });
  } catch (error) {
    console.error('Community action failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not complete the community action.' },
      { status: 500 },
    );
  }
}
