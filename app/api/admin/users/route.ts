import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateRequest,
  getAdminBackendClient,
  getCurrentUtcMonthStart,
  isAdminEmail,
} from '@/lib/plan-access';

export const runtime = 'nodejs';

const PAGE_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BackendUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  profile: { name?: string } | null;
};

type AdminPlanId = 'basic' | 'advanced';

async function requireAdmin(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.user) return auth;
  if (!auth.user.emailVerified || !isAdminEmail(auth.user.email)) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Admin access is required.' }, { status: 403 }),
    };
  }
  return auth;
}

async function getUsers(search: string, offset: number) {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const apiKey = process.env.INSFORGE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('Admin user lookup is not configured on the server.');
  }

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (search) params.set('search', search);

  const response = await fetch(`${baseUrl}/api/auth/users?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });
  const payload = (await response.json()) as {
    data?: BackendUser[];
    pagination?: { offset: number; limit: number; total: number };
    message?: string;
  };
  const users = payload.data;

  if (!response.ok || !Array.isArray(users) || !payload.pagination) {
    throw new Error(payload.message || 'Could not retrieve user accounts.');
  }

  return { data: users, pagination: payload.pagination };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.user) return auth.response;

    const search = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100);
    const rawOffset = Number(request.nextUrl.searchParams.get('offset') ?? 0);
    const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const payload = await getUsers(search, offset);
    const userIds = payload.data.map((user) => user.id);

    const admin = getAdminBackendClient();
    const [accessResult, usageResult, geminiResult] = userIds.length
      ? await Promise.all([
          admin
            .database.from('user_plan_access')
            .select('user_id, plan_id, status, starts_at, expires_at')
            .in('user_id', userIds),
          admin
            .database.from('user_plan_monthly_usage')
            .select('user_id, documents_generated, uploads_used')
            .eq(
              'month_start',
              getCurrentUtcMonthStart(),
            )
            .in('user_id', userIds),
          admin.database.rpc('admin_gemini_usage_summary', {
            target_user_ids: userIds,
            month_start: `${getCurrentUtcMonthStart()}T00:00:00.000Z`,
          }),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

    if (accessResult.error) throw new Error(accessResult.error.message);
    if (usageResult.error) throw new Error(usageResult.error.message);
    if (geminiResult.error) throw new Error(geminiResult.error.message);

    const accesses = new Map(
      (accessResult.data ?? []).map((row) => [row.user_id, row]),
    );
    const usages = new Map((usageResult.data ?? []).map((row) => [row.user_id, row]));
    const geminiUsage = new Map<
      string,
      { requests: number; promptTokens: number; candidateTokens: number; totalTokens: number; failed: number }
    >();
    for (const event of geminiResult.data ?? []) {
      const totals = geminiUsage.get(event.user_id) ?? {
        requests: 0,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        failed: 0,
      };
      totals.requests += Number(event.request_count);
      totals.promptTokens += Number(event.prompt_tokens);
      totals.candidateTokens += Number(event.candidate_tokens);
      totals.totalTokens += Number(event.total_tokens);
      totals.failed += Number(event.failed_requests);
      geminiUsage.set(event.user_id, totals);
    }
    const users = payload.data.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.profile?.name ?? null,
      emailVerified: user.emailVerified,
      access: accesses.get(user.id) ?? null,
      limits:
        accesses.get(user.id)?.plan_id === 'advanced'
          ? { documents: 50, uploads: 15 }
          : { documents: 25, uploads: 5 },
      usage: usages.get(user.id) ?? {
        documents_generated: 0,
        uploads_used: 0,
      },
      geminiUsage: geminiUsage.get(user.id) ?? {
        requests: 0,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        failed: 0,
      },
    }));

    return NextResponse.json({
      users,
      pagination: payload.pagination,
    });
  } catch (error) {
    console.error('Admin user listing failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load users.' },
      { status: 500 },
    );
  }
}

function addOneCalendarMonth(value: Date) {
  const result = new Date(value);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.user) return auth.response;

    let body: { userId?: unknown; action?: unknown; planId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }

    if (
      typeof body.userId !== 'string' ||
      !UUID_PATTERN.test(body.userId) ||
      (body.action !== 'grant' && body.action !== 'revoke') ||
      (body.action === 'grant' && body.planId !== 'basic' && body.planId !== 'advanced')
    ) {
      return NextResponse.json({ error: 'Choose a valid user and action.' }, { status: 400 });
    }
    const planId: AdminPlanId = body.planId === 'advanced' ? 'advanced' : 'basic';

    const admin = getAdminBackendClient();
    const { data: current, error: currentError } = await admin
      .database.from('user_plan_access')
      .select('user_id, plan_id, status, starts_at, expires_at')
      .eq('user_id', body.userId)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);

    const now = new Date();
    if (body.action === 'grant') {
      const ongoing =
        current?.status === 'active' &&
        new Date(current.expires_at).getTime() > now.getTime();
      const startsAt = ongoing ? new Date(current.starts_at) : now;
      const expirationBase = ongoing ? new Date(current.expires_at) : now;
      const { error } = await admin.database.from('user_plan_access').upsert(
        [
          {
            user_id: body.userId,
            plan_id: planId,
            status: 'active',
            starts_at: startsAt.toISOString(),
            expires_at: addOneCalendarMonth(expirationBase).toISOString(),
            updated_by: auth.user.id,
            updated_at: now.toISOString(),
          },
        ],
        { onConflict: 'user_id' },
      );
      if (error) throw new Error(error.message);
    } else {
      if (!current) {
        return NextResponse.json({ error: 'This user has no plan access to revoke.' }, { status: 404 });
      }
      const { error } = await admin
        .database.from('user_plan_access')
        .update({
          status: 'revoked',
          expires_at: now.toISOString(),
          updated_by: auth.user.id,
          updated_at: now.toISOString(),
        })
        .eq('user_id', body.userId);
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin plan update failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update plan access.' },
      { status: 500 },
    );
  }
}
