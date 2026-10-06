import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPageSession } from '@/lib/admin-security';
import { authenticateRequest, getAdminBackendClient, isAdminEmail } from '@/lib/plan-access';

export const runtime = 'nodejs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireAdmin(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.user) return auth;
  if (!auth.user.emailVerified || !isAdminEmail(auth.user.email)) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Admin access is required.' }, { status: 403 }),
    };
  }
  const sessionResponse = await requireAdminPageSession(request);
  if (sessionResponse) return { user: null, response: sessionResponse };
  return auth;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.user) return auth.response;

    const admin = getAdminBackendClient();
    const { data, error } = await admin.database
      .from('payment_requests')
      .select('id, user_id, user_email, plan_id, mpesa_reference, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) throw new Error(error.message);

    return NextResponse.json({ requests: data ?? [] }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Admin payment request lookup failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load payment requests.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.user) return auth.response;

    let body: { requestId?: unknown; action?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }

    if (
      typeof body.requestId !== 'string' ||
      !UUID_PATTERN.test(body.requestId) ||
      (body.action !== 'grant' && body.action !== 'issue_code' && body.action !== 'reject')
    ) {
      return NextResponse.json({ error: 'Choose a valid payment request and action.' }, { status: 400 });
    }

    const code = body.action === 'issue_code' ? randomBytes(18).toString('hex').toUpperCase() : null;
    const admin = getAdminBackendClient();
    const { error } = await admin.database.rpc('fulfill_payment_request', {
      target_request_id: body.requestId,
      target_action: body.action,
      target_admin_id: auth.user.id,
      target_code_hash: code ? createHash('sha256').update(code).digest('hex') : null,
    });

    if (error) {
      if (error.message.includes('PAYMENT_REQUEST_NOT_PENDING')) {
        return NextResponse.json(
          { error: 'This payment request has already been processed. Refresh the queue.' },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json({
      success: true,
      action: body.action,
      code,
      message:
        body.action === 'grant'
          ? 'Payment approved and plan access activated.'
          : body.action === 'issue_code'
            ? 'One-time access code generated. Copy it now and send it to the user.'
            : 'Payment request rejected.',
    });
  } catch (error) {
    console.error('Admin payment review failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not process payment request.' },
      { status: 500 },
    );
  }
}
