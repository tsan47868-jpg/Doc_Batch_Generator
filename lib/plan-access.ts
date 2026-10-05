import 'server-only';

import { createAdminClient, createClient } from '@insforge/sdk';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export type PlanId = 'basic' | 'advanced';

export const PLAN_LIMITS: Record<PlanId, { documents: number; uploads: number }> = {
  basic: { documents: 25, uploads: 5 },
  advanced: { documents: 50, uploads: 15 },
};

export type PlanAccessRow = {
  plan_id: PlanId;
  status: 'active' | 'revoked';
  starts_at: string;
  expires_at: string;
  updated_at: string;
};

export type PlanUsageRow = {
  documents_generated: number;
  uploads_used: number;
};

function backendUrl() {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
  if (!url) throw new Error('Missing NEXT_PUBLIC_INSFORGE_URL.');
  return url;
}

export function getAdminBackendClient() {
  const apiKey = process.env.INSFORGE_API_KEY;
  if (!apiKey) throw new Error('Missing server-only INSFORGE_API_KEY.');
  return createAdminClient({ baseUrl: backendUrl(), apiKey });
}

export async function authenticateRequest(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 }),
    };
  }

  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!anonKey) throw new Error('Missing NEXT_PUBLIC_INSFORGE_ANON_KEY.');

  const client = createClient({
    baseUrl: backendUrl(),
    anonKey,
    accessToken: token,
    isServerMode: true,
  });
  const { data, error } = await client.auth.getCurrentUser();

  if (error || !data?.user) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 }),
    };
  }

  return { user: data.user, response: null };
}

export function isAdminEmail(email: string | undefined) {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(adminEmail && email?.trim().toLowerCase() === adminEmail);
}

export function getCurrentUtcMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export async function getUserPlanState(userId: string) {
  const admin = getAdminBackendClient();
  const [accessResult, usageResult] = await Promise.all([
    admin
      .database.from('user_plan_access')
      .select('plan_id, status, starts_at, expires_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .database.from('user_plan_monthly_usage')
      .select('documents_generated, uploads_used')
      .eq('user_id', userId)
      .eq('month_start', getCurrentUtcMonthStart())
      .maybeSingle(),
  ]);

  if (accessResult.error) throw new Error(accessResult.error.message);
  if (usageResult.error) throw new Error(usageResult.error.message);

  const access = accessResult.data as PlanAccessRow | null;
  const usage = (usageResult.data as PlanUsageRow | null) ?? {
    documents_generated: 0,
    uploads_used: 0,
  };
  const now = Date.now();
  const active = Boolean(
    access &&
      access.status === 'active' &&
      new Date(access.starts_at).getTime() <= now &&
      new Date(access.expires_at).getTime() > now,
  );

  const plan = active ? access?.plan_id ?? null : null;
  const limits = plan ? PLAN_LIMITS[plan] : { documents: 0, uploads: 0 };

  return { access, usage, active, plan, limits };
}
