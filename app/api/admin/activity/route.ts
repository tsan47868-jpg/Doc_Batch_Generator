import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, getAdminBackendClient, isAdminEmail } from '@/lib/plan-access';

export const runtime = 'nodejs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GeminiActivitySummary = {
  generation_request_id: string;
  call_count: number | string;
  prompt_tokens: number | string;
  candidate_tokens: number | string;
  total_tokens: number | string;
  failed_calls: number | string;
};

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.user) return auth.response;
    if (!auth.user.emailVerified || !isAdminEmail(auth.user.email)) {
      return NextResponse.json({ error: 'Admin access is required.' }, { status: 403 });
    }

    const userId = request.nextUrl.searchParams.get('userId') ?? '';
    if (!UUID_PATTERN.test(userId)) {
      return NextResponse.json({ error: 'Choose a valid user account.' }, { status: 400 });
    }

    const admin = getAdminBackendClient();
    const { data: requests, error: requestError } = await admin.database
      .from('generation_requests')
      .select(
        'id, chat_id, plan_id, instructions, request_kind, status, documents_requested, documents_succeeded, documents_failed, created_at, completed_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (requestError) throw new Error(requestError.message);

    const requestIds = (requests ?? []).map((item) => item.id);
    const [eventResult, documentResult] = requestIds.length
      ? await Promise.all([
          admin.database.rpc('admin_gemini_activity_summary', {
            target_request_ids: requestIds,
          }),
          admin.database
            .from('generation_request_documents')
            .select('generation_request_id, doc_index, title, description, status, created_at')
            .in('generation_request_id', requestIds)
            .order('created_at', { ascending: false }),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];

    if (eventResult.error) throw new Error(eventResult.error.message);
    if (documentResult.error) throw new Error(documentResult.error.message);

    const eventSummaries = (eventResult.data ?? []) as GeminiActivitySummary[];
    const eventsByRequest = new Map<string, GeminiActivitySummary>(
      eventSummaries.map((event) => [event.generation_request_id, event]),
    );
    const documentsByRequest = new Map<string, typeof documentResult.data>();
    for (const document of documentResult.data ?? []) {
      const list = documentsByRequest.get(document.generation_request_id) ?? [];
      list.push(document);
      documentsByRequest.set(document.generation_request_id, list);
    }

    const activity = (requests ?? []).map((item) => {
      const usage = eventsByRequest.get(item.id);
      return {
        ...item,
        gemini: {
          calls: Number(usage?.call_count ?? 0),
          promptTokens: Number(usage?.prompt_tokens ?? 0),
          candidateTokens: Number(usage?.candidate_tokens ?? 0),
          totalTokens: Number(usage?.total_tokens ?? 0),
          failedCalls: Number(usage?.failed_calls ?? 0),
        },
        documents: documentsByRequest.get(item.id) ?? [],
      };
    });

    return NextResponse.json({ activity }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Admin activity lookup failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load account activity.' },
      { status: 500 },
    );
  }
}
