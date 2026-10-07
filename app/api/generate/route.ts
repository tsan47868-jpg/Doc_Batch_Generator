import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import mammoth from 'mammoth';
import { geminiJson, GeminiQuotaError } from '@/lib/gemini';
import type { GeminiAttempt } from '@/lib/gemini';
import { isGenerationMode } from '@/lib/generation-modes';
import type { GenerationMode } from '@/lib/generation-modes';
import { openrouterJson } from '@/lib/openrouter';
import { buildDocx } from '@/lib/docx-builder';
import {
  authenticateRequest,
  getAdminBackendClient,
  getCurrentUtcMonthStart,
  getUserPlanState,
} from '@/lib/plan-access';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SAMPLE_CHARS = 30000;
const DOC_COUNT = 10;
const CONCURRENCY = 3;
const RETRY_DELAYS_MS = [0, 2000, 5000];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TEXT_EXT = /\.(txt|md|markdown|csv|json|html?)$/i;

type DocPlan = { title: string; description: string };
type DocItem = DocPlan & { index: number };

const planSchema = {
  type: 'object',
  properties: {
    documents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['title', 'description'],
      },
    },
  },
  required: ['documents'],
};

const docSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['title', 'content'],
};

async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (name.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (TEXT_EXT.test(name)) {
    return buf.toString('utf8');
  }
  throw new Error(
    'Unsupported file type. Please upload a .txt, .md, .csv, .json, .html or .docx file.',
  );
}

async function pool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  const results = await Promise.allSettled(workers);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) throw failure.reason;
}

export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth.user) return auth.response;

  let planState: Awaited<ReturnType<typeof getUserPlanState>>;
  try {
    planState = await getUserPlanState(auth.user);
  } catch (error) {
    console.error('Plan access check failed:', error);
    return NextResponse.json(
      { error: 'Could not verify plan access. Please try again.' },
      { status: 503 },
    );
  }

  if (!planState.active || !planState.plan) {
    return NextResponse.json(
      { error: 'Your plan is not active. Contact the administrator for access.' },
      { status: 403 },
    );
  }

  let file: File | null = null;
  let instructions = '';
  let chatId = '';
  let retryMode = false;
  let retryItems: DocItem[] | null = null;
  let generationMode: GenerationMode = 'gemini-1';

  try {
    const form = await req.formData();
    const f = form.get('file');
    file = f instanceof File ? f : null;
    instructions = String(form.get('instructions') || '').slice(0, 2000).trim();
    chatId = String(form.get('chatId') || '');
    retryMode = form.get('retryMode') === 'true';
    const requestedMode = form.get('generationMode');
    if (requestedMode !== null) {
      if (typeof requestedMode !== 'string' || !isGenerationMode(requestedMode)) {
        throw new Error('Invalid generation mode.');
      }
      generationMode = requestedMode;
    }

    const retryRaw = form.get('retry');
    if (typeof retryRaw === 'string' && retryRaw.trim()) {
      const parsed: unknown = JSON.parse(retryRaw);
      if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > DOC_COUNT) {
        throw new Error('Invalid retry payload.');
      }
      const seen = new Set<number>();
      const items: DocItem[] = [];
      for (const x of parsed) {
        const item = x as Partial<DocItem>;
        const index = Number(item?.index);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= DOC_COUNT ||
          seen.has(index) ||
          typeof item?.title !== 'string' ||
          !item.title.trim() ||
          item.title.trim().length > 200 ||
          typeof item?.description !== 'string' ||
          item.description.length > 2000
        ) {
          throw new Error('Invalid retry payload.');
        }
        seen.add(index);
        items.push({ index, title: item.title, description: item.description });
      }
      retryItems = items;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!UUID_PATTERN.test(chatId)) {
    return NextResponse.json({ error: 'A valid generation request is required.' }, { status: 400 });
  }

  const remainingDocuments = Math.max(
    0,
    planState.limits.documents - planState.usage.documents_generated,
  );
  let billableRetryCount = 0;
  if (retryItems) {
    try {
      const admin = getAdminBackendClient();
      const { data: charges, error } = await admin.database
        .from('plan_document_charges')
        .select('doc_index')
        .eq('user_id', auth.user.id)
        .eq('month_start', getCurrentUtcMonthStart())
        .eq('chat_id', chatId)
        .in('doc_index', retryItems.map(({ index }) => index));
      if (error) throw new Error(error.message);
      const chargedIndexes = new Set((charges ?? []).map((row) => row.doc_index));
      billableRetryCount = retryItems.filter(({ index }) => !chargedIndexes.has(index)).length;
    } catch (error) {
      console.error('Generation quota check failed:', error);
      return NextResponse.json(
        { error: 'Could not verify document quota. Please try again.' },
        { status: 503 },
      );
    }
    if (billableRetryCount > remainingDocuments) {
      return NextResponse.json(
        { error: `Only ${remainingDocuments} generated document${remainingDocuments === 1 ? '' : 's'} remain in this month's plan.` },
        { status: 429 },
      );
    }
  } else if (remainingDocuments === 0) {
    return NextResponse.json(
      { error: `You have reached the ${planState.limits.documents}-document limit for this month.` },
      { status: 429 },
    );
  }
  const batchSize = Math.min(DOC_COUNT, remainingDocuments);

  const apiKey =
    generationMode === 'gemini-1'
      ? process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY
      : generationMode === 'gemini-2'
        ? process.env.GEMINI_API_KEY_2
        : generationMode === 'gemini-3'
          ? process.env.GEMINI_API_KEY_3
          : process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    if (generationMode !== 'gemini-1') {
      const keyName = {
        'gemini-2': 'GEMINI_API_KEY_2',
        'gemini-3': 'GEMINI_API_KEY_3',
        'openrouter-free': 'OPENROUTER_API_KEY',
      }[generationMode];
      return NextResponse.json(
        { error: `This mode is not configured. Ask the administrator to set ${keyName}.` },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'Server is missing GEMINI_API_KEY_1 (or GEMINI_API_KEY). Add it to .env.local.' },
      { status: 500 },
    );
  }
  if (!file) {
    return NextResponse.json({ error: 'Please upload a sample file.' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File is larger than 10 MB.' }, { status: 400 });
  }

  let sampleText: string;
  try {
    sampleText = await extractText(file);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not read the file.' },
      { status: 400 },
    );
  }
  if (!sampleText.trim()) {
    return NextResponse.json(
      { error: 'The uploaded file appears to be empty.' },
      { status: 400 },
    );
  }

  const sample = sampleText.slice(0, MAX_SAMPLE_CHARS);
  const sampleNote =
    sampleText.length > MAX_SAMPLE_CHARS
      ? '\n\n(Sample truncated for length.)'
      : '';

  const admin = getAdminBackendClient();
  const { data: chat, error: chatError } = await admin.database
    .from('chats')
    .select('id, instructions')
    .eq('id', chatId)
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (chatError) {
    console.error('Generation chat lookup failed:', chatError);
    return NextResponse.json({ error: 'Could not verify this generation.' }, { status: 503 });
  }
  if (!chat) {
    return NextResponse.json({ error: 'This generation does not belong to your account.' }, { status: 404 });
  }

  const requestId = randomUUID();
  const requestInstructions = instructions || chat.instructions || '';
  const requestedCount = retryItems?.length ?? batchSize;
  const { error: requestError } = await admin.database
    .from('generation_requests')
    .insert([{
      id: requestId,
      user_id: auth.user.id,
      chat_id: chatId,
      plan_id: planState.plan,
      instructions: requestInstructions,
      request_kind: retryMode || retryItems ? 'retry' : 'generate',
      documents_requested: requestedCount,
      status: 'processing',
    }]);
  if (requestError) {
    console.error('Generation request tracking failed:', requestError);
    return NextResponse.json(
      { error: 'Could not start generation tracking. Please try again.' },
      { status: 503 },
    );
  }

  const generateJson = async <T>(
    prompt: string,
    schema: object,
    temperature = 0.9,
    attempts = 4,
    options: { onAttempt?: (attempt: GeminiAttempt) => Promise<void> } = {},
  ): Promise<T> =>
    generationMode === 'openrouter-free'
      ? openrouterJson<T>(apiKey, prompt, schema, temperature, attempts, options)
      : geminiJson<T>(apiKey, prompt, schema, temperature, attempts, options);

  let modelCallNumber = 0;
  const trackModelAttempt = async (
    operation: 'planning' | 'document',
    docIndex: number | null,
    attempt: GeminiAttempt,
  ) => {
    modelCallNumber += 1;
    const { error } = await admin.database.from('gemini_usage_events').insert([{
      generation_request_id: requestId,
      user_id: auth.user.id,
      operation,
      doc_index: docIndex,
      model: attempt.model,
      http_status: attempt.httpStatus,
      prompt_tokens: attempt.promptTokens,
      candidate_tokens: attempt.candidateTokens,
      total_tokens: attempt.totalTokens,
      success: attempt.success,
      created_at: new Date().toISOString(),
    }]);
    if (error) {
      throw new Error(`Could not record AI usage for call ${modelCallNumber}: ${error.message}`);
    }
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      let requestStatus: 'completed' | 'partial' | 'failed' = 'failed';
      let succeededCount = 0;
      let failedCount = 0;

      try {
        let docs: DocItem[];

        if (retryItems) {
          docs = retryItems;
        } else {
          const planPrompt = [
            'You are a document generation assistant. Based on the SAMPLE provided below,',
            `propose exactly ${batchSize} distinct documents to generate.`,
            'Each document must imitate the style, tone, vocabulary and structure of the sample,',
            'but cover its own distinct topic, purpose or angle so the 10 documents do not overlap.',
            instructions ? `\nUser instructions: ${instructions}` : '',
            '\nReturn JSON with a "documents" array of objects, each with "title" and "description".',
            `\nSAMPLE:\n"""\n${sample}\n"""${sampleNote}`,
          ].join(' ');

          const plan = await generateJson<{ documents: DocPlan[] }>(
            planPrompt,
            planSchema,
            0.8,
            4,
            { onAttempt: (attempt) => trackModelAttempt('planning', null, attempt) },
          );
          const planned = (plan.documents || []).slice(0, batchSize);
          if (planned.length === 0) {
            throw new Error('The selected AI mode could not propose documents from this sample. Try again.');
          }
          docs = planned.map((d, i) => ({
            title: d.title.trim().slice(0, 200),
            description: d.description.trim().slice(0, 2000),
            index: i,
          })).filter((d) => d.title.length > 0);
          if (docs.length === 0) {
            throw new Error('The selected AI mode returned no usable document titles. Please try again.');
          }
          send({
            type: 'plan',
            documents: docs.map(({ title, description }) => ({ title, description })),
          });
        }

        const failures: { index: number; message: string }[] = [];

        await pool(docs, CONCURRENCY, async (d) => {
          let lastMessage = 'Generation failed';
          for (let pass = 0; pass < RETRY_DELAYS_MS.length; pass++) {
            if (RETRY_DELAYS_MS[pass] > 0) {
              await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[pass]));
            }
            try {
              const docPrompt = [
                `Write the complete content for a document titled "${d.title}".`,
                `Document purpose: ${d.description}`,
                'It must closely imitate the style, tone, vocabulary, formatting and structure of the SAMPLE below.',
                'Format the content as plain text with simple markdown only:',
                '## for section headings, - for bullet lists, 1. for numbered lists, **bold** for emphasis.',
                'Do NOT start with the title or any heading-like first line; begin directly with the body text.',
                planState.plan === 'advanced'
                  ? 'Write an in-depth, polished document of roughly 1200-2200 words with a clear introduction, logical sections, practical detail, and a concise conclusion. Use headings, lists, and emphasis where they improve readability.'
                  : 'Write a complete, polished document of roughly 600-1200 words.',
                `\nSAMPLE:\n"""\n${sample}\n"""${sampleNote}`,
              ].join(' ');

              const doc = await generateJson<{ title: string; content: string }>(
                docPrompt,
                docSchema,
                0.95,
                4,
                { onAttempt: (attempt) => trackModelAttempt('document', d.index, attempt) },
              );

              const buf = await buildDocx(d.title, doc.content);
              const { error: chargeError } = await admin.database.rpc('charge_plan_document', {
                target_user: auth.user.id,
                target_chat: chatId,
                target_index: d.index,
                target_title: d.title,
                target_description: d.description,
              });
              if (chargeError) throw new Error(`Could not apply the document quota: ${chargeError.message}`);
              const { error: historyError } = await admin.database
                .from('generation_request_documents')
                .insert([{
                  generation_request_id: requestId,
                  doc_index: d.index,
                  title: d.title,
                  description: d.description,
                  status: 'generated',
                }]);
              if (historyError) throw new Error(`Could not save generated document history: ${historyError.message}`);
              succeededCount += 1;
              send({
                type: 'doc',
                index: d.index,
                title: d.title,
                description: d.description,
                content: doc.content,
                docx: buf.toString('base64'),
              });
              return;
            } catch (e) {
              lastMessage = e instanceof Error ? e.message : lastMessage;
              // A spent daily quota cannot recover within this batch — fail fast.
              if (e instanceof GeminiQuotaError) break;
            }
          }

          failures.push({ index: d.index, message: lastMessage });
          const { error: historyError } = await admin.database
            .from('generation_request_documents')
            .insert([{
              generation_request_id: requestId,
              doc_index: d.index,
              title: d.title,
              description: d.description,
              status: 'failed',
            }]);
          if (historyError) {
            throw new Error(`Could not save failed document history: ${historyError.message}`);
          }
          send({ type: 'doc_error', index: d.index, message: lastMessage });
        });

        if (failures.length === 0) {
          requestStatus = 'completed';
          send({ type: 'done' });
        } else {
          failedCount = failures.length;
          requestStatus = succeededCount > 0 ? 'partial' : 'failed';
          const ok = docs.length - failures.length;
          send({
            type: 'error',
            message: `${failures.length} of ${docs.length} documents failed to generate (${ok} completed). ${failures[0].message}`,
          });
        }
      } catch (e) {
        send({
          type: 'error',
          message: e instanceof Error ? e.message : 'Generation failed. Please try again.',
        });
      } finally {
        const { error } = await admin.database
          .from('generation_requests')
          .update({
            status: requestStatus,
            documents_succeeded: succeededCount,
            documents_failed: failedCount,
            completed_at: new Date().toISOString(),
          })
          .eq('id', requestId);
        if (error) {
          console.error('Generation request completion tracking failed:', error);
          send({ type: 'error', message: 'Generation finished, but its request history could not be updated.' });
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
    },
  });
}
