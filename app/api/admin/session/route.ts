import { NextRequest, NextResponse } from 'next/server';
import {
  createAdminSessionToken,
  getAdminSessionCookieName,
  getAdminSessionCookieOptions,
  getRequestIp,
  hasValidAdminSession,
  isAdminIpBlocked,
  MAX_PASSWORD_ATTEMPTS,
  updateAdminPasswordAttempts,
  verifyAdminPagePassword,
} from '@/lib/admin-security';
import { authenticateRequest, isAdminEmail } from '@/lib/plan-access';

export const runtime = 'nodejs';

async function requireAdminIdentity(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.user) return { user: null, response: auth.response };
  if (!auth.user.emailVerified || !isAdminEmail(auth.user.email)) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Sign in with the verified admin account.' }, { status: 403 }),
    };
  }
  return { user: auth.user, response: null };
}

function unavailableIpResponse() {
  return NextResponse.json(
    { error: 'Could not determine your network address securely. Contact the administrator.' },
    { status: 503 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminIdentity(request);
    if (!auth.user) return auth.response;

    const ip = getRequestIp(request);
    if (!ip) return unavailableIpResponse();

    const attemptState = await updateAdminPasswordAttempts(ip, 'status');
    if (isAdminIpBlocked(attemptState)) {
      return NextResponse.json(
        { error: 'This IP address is blocked after three incorrect password attempts.', blockedUntil: attemptState.blocked_until },
        { status: 429 },
      );
    }

    return NextResponse.json({ authenticated: hasValidAdminSession(request) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Admin session check failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not check admin access.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminIdentity(request);
    if (!auth.user) return auth.response;

    const ip = getRequestIp(request);
    if (!ip) return unavailableIpResponse();

    let body: { password?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    if (typeof body.password !== 'string' || body.password.length === 0 || body.password.length > 256) {
      return NextResponse.json({ error: 'Enter the admin page password.' }, { status: 400 });
    }

    const currentState = await updateAdminPasswordAttempts(ip, 'status');
    if (isAdminIpBlocked(currentState)) {
      return NextResponse.json(
        { error: 'This IP address is blocked after three incorrect password attempts.', blockedUntil: currentState.blocked_until },
        { status: 429 },
      );
    }

    if (!verifyAdminPagePassword(body.password)) {
      const attemptState = await updateAdminPasswordAttempts(ip, 'failure');
      if (isAdminIpBlocked(attemptState)) {
        return NextResponse.json(
          { error: 'Too many incorrect passwords. This IP address is blocked for 24 hours.', blockedUntil: attemptState.blocked_until },
          { status: 429 },
        );
      }
      const attemptsRemaining = Math.max(0, MAX_PASSWORD_ATTEMPTS - attemptState.failed_attempts);
      return NextResponse.json(
        { error: `Incorrect admin password. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.` },
        { status: 401 },
      );
    }

    await updateAdminPasswordAttempts(ip, 'success');
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(
      getAdminSessionCookieName(),
      createAdminSessionToken(),
      getAdminSessionCookieOptions(),
    );
    return response;
  } catch (error) {
    console.error('Admin password verification failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not verify admin password.' },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(getAdminSessionCookieName(), '', {
    ...getAdminSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
