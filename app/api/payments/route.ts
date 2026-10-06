import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, getAdminBackendClient } from '@/lib/plan-access';

export const runtime = 'nodejs';

const REFERENCE_PATTERN = /^[A-Z0-9]{5,20}$/;
const CODE_PATTERN = /^[A-F0-9]{36}$/;

function codeDigest(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.user) return auth.response;

    const admin = getAdminBackendClient();
    const { data, error } = await admin.database
      .from('payment_requests')
      .select('id, plan_id, mpesa_reference, status, created_at')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);

    return NextResponse.json({ paymentRequest: data ?? null }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Payment request lookup failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load payment status.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.user) return auth.response;

    if (!auth.user.emailVerified || !auth.user.email) {
      return NextResponse.json(
        { error: 'Verify your email address before submitting payment for review.' },
        { status: 403 },
      );
    }

    let body: { planId?: unknown; mpesaReference?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }

    if (
      (body.planId !== 'basic' && body.planId !== 'advanced') ||
      typeof body.mpesaReference !== 'string'
    ) {
      return NextResponse.json({ error: 'Choose a plan and enter the M-Pesa receipt code.' }, { status: 400 });
    }

    const mpesaReference = body.mpesaReference.trim().toUpperCase();
    if (!REFERENCE_PATTERN.test(mpesaReference)) {
      return NextResponse.json(
        { error: 'Enter the M-Pesa receipt code using 5–20 letters or numbers.' },
        { status: 400 },
      );
    }

    const admin = getAdminBackendClient();
    const { data, error } = await admin.database.from('payment_requests').insert([
      {
        user_id: auth.user.id,
        user_email: auth.user.email,
        plan_id: body.planId,
        mpesa_reference: mpesaReference,
      },
    ]).select('id, plan_id, mpesa_reference, status, created_at').single();

    if (error) {
      if (error.message.includes('payment_requests_one_pending_per_user_idx')) {
        return NextResponse.json(
          { error: 'You already have a payment waiting for administrator review.' },
          { status: 409 },
        );
      }
      if (error.message.toLowerCase().includes('duplicate key')) {
        return NextResponse.json(
          { error: 'That M-Pesa receipt code has already been submitted.' },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ paymentRequest: data }, { status: 201 });
  } catch (error) {
    console.error('Payment submission failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not submit payment for review.' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.user) return auth.response;

    let body: { code?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }

    if (typeof body.code !== 'string') {
      return NextResponse.json({ error: 'Enter the access code sent by the administrator.' }, { status: 400 });
    }

    const normalizedCode = body.code.toUpperCase().replace(/[-\s]/g, '');
    if (!CODE_PATTERN.test(normalizedCode)) {
      return NextResponse.json({ error: 'The access code is not valid.' }, { status: 400 });
    }

    const admin = getAdminBackendClient();
    const { data, error } = await admin.database.rpc('redeem_payment_access_code', {
      target_code_hash: codeDigest(normalizedCode),
      target_user_id: auth.user.id,
    });
    if (error) {
      if (error.message.includes('PAYMENT_CODE_INVALID_OR_EXPIRED')) {
        return NextResponse.json(
          { error: 'That access code is invalid, expired, already used, or belongs to another account.' },
          { status: 400 },
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, access: data?.[0] ?? null });
  } catch (error) {
    console.error('Payment code redemption failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not redeem the access code.' },
      { status: 500 },
    );
  }
}
