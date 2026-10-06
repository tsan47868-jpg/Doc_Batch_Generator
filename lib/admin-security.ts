import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAdminBackendClient } from '@/lib/plan-access';

const ADMIN_SESSION_COOKIE = 'doc_batch_admin_session';
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const MAX_PASSWORD_ATTEMPTS = 3;

function getAdminPassword() {
  const password = process.env.ADMIN_PAGE_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('ADMIN_PAGE_PASSWORD must be set to at least 12 characters.');
  }
  return password;
}

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('ADMIN_SESSION_SECRET must be set to at least 32 bytes.');
  }
  return secret;
}

export function getAdminSessionCookieName() {
  return ADMIN_SESSION_COOKIE;
}

export function getAdminSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/api/admin',
    maxAge: SESSION_DURATION_SECONDS,
  };
}

export function createAdminSessionToken() {
  const payload = Buffer.from(
    `${Date.now() + SESSION_DURATION_SECONDS * 1000}:${randomBytes(32).toString('base64url')}`,
  ).toString('base64url');
  const signature = createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function hasValidAdminSession(request: NextRequest) {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return false;

  const [payload, suppliedSignature, ...extra] = token.split('.');
  if (!payload || !suppliedSignature || extra.length > 0) return false;

  const expectedSignature = createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest();
  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return false;
  }
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return false;
  }

  try {
    const [expiresAt] = Buffer.from(payload, 'base64url').toString().split(':');
    return Number.isSafeInteger(Number(expiresAt)) && Number(expiresAt) > Date.now();
  } catch {
    return false;
  }
}

export function verifyAdminPagePassword(password: string) {
  const expected = createHmac('sha256', getSessionSecret())
    .update(getAdminPassword())
    .digest();
  const supplied = createHmac('sha256', getSessionSecret()).update(password).digest();
  return timingSafeEqual(supplied, expected);
}

export function getRequestIp(request: NextRequest) {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp && isIP(realIp)) return realIp;

  const forwardedIps = request.headers.get('x-forwarded-for')?.split(',') ?? [];
  for (const candidate of forwardedIps.reverse()) {
    const ip = candidate.trim();
    if (isIP(ip)) return ip;
  }
  return null;
}

function getIpHash(ip: string) {
  return createHmac('sha256', getSessionSecret()).update(ip).digest('hex');
}

export type AdminPasswordAttemptState = {
  failed_attempts: number;
  blocked_until: string | null;
};

export async function updateAdminPasswordAttempts(ip: string, action: 'status' | 'failure' | 'success') {
  const admin = getAdminBackendClient();
  const { data, error } = await admin.database.rpc('record_admin_password_attempt', {
    target_ip_hash: getIpHash(ip),
    target_action: action,
  });
  if (error) throw new Error(error.message);

  const state = data?.[0] as AdminPasswordAttemptState | undefined;
  if (!state) throw new Error('Could not read admin password attempt status.');
  return state;
}

export function isAdminIpBlocked(state: AdminPasswordAttemptState) {
  return Boolean(state.blocked_until && new Date(state.blocked_until).getTime() > Date.now());
}

export async function requireAdminPageSession(request: NextRequest) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ error: 'Unlock the admin page with its password first.' }, { status: 401 });
  }

  const ip = getRequestIp(request);
  if (!ip) {
    return NextResponse.json(
      { error: 'Could not determine your network address securely.' },
      { status: 503 },
    );
  }

  const attemptState = await updateAdminPasswordAttempts(ip, 'status');
  if (isAdminIpBlocked(attemptState)) {
    return NextResponse.json(
      {
        error: 'This IP address is blocked after three incorrect password attempts.',
        blockedUntil: attemptState.blocked_until,
      },
      { status: 429 },
    );
  }
  return null;
}

export { MAX_PASSWORD_ATTEMPTS, SESSION_DURATION_SECONDS };
