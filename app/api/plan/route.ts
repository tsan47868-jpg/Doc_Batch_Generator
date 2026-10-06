import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, getUserPlanState } from '@/lib/plan-access';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.user) return auth.response;

    const { access, usage, active, plan, limits } = await getUserPlanState(auth.user);
    return NextResponse.json({
      plan,
      active,
      expiresAt: access?.expires_at ?? null,
      usage: {
        documentsGenerated: usage.documents_generated,
        documentsLimit: limits.documents,
        documentsRemaining: Math.max(0, limits.documents - usage.documents_generated),
        uploadsUsed: usage.uploads_used,
        uploadsLimit: limits.uploads,
        uploadsRemaining: Math.max(0, limits.uploads - usage.uploads_used),
      },
    });
  } catch (error) {
    console.error('Plan status lookup failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load plan status.' },
      { status: 500 },
    );
  }
}
