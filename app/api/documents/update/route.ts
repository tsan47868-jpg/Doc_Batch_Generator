import { NextRequest, NextResponse } from 'next/server';
import { buildDocx } from '@/lib/docx-builder';
import { authenticateRequest, getAdminBackendClient } from '@/lib/plan-access';

export const runtime = 'nodejs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth.user) return auth.response;

  try {
    const body = await req.json();
    const { chatId, docIndex, title, description, content } = body as {
      chatId?: string;
      docIndex?: number;
      title?: string;
      description?: string;
      content?: string;
    };

    if (typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
    }
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Content is required.' }, { status: 400 });
    }

    const trimmedTitle = title.trim().slice(0, 200);
    const trimmedDesc = (description || '').trim().slice(0, 2000);
    const docxBuf = await buildDocx(trimmedTitle, content);
    const docxBase64 = docxBuf.toString('base64');

    let docxKey: string | undefined;

    if (chatId && UUID_PATTERN.test(chatId) && typeof docIndex === 'number' && docIndex >= 0) {
      const admin = getAdminBackendClient();
      const storageKey = `${auth.user.id}/${chatId}/docs/${String(docIndex + 1).padStart(2, '0')}.docx`;

      // Upload new docx to storage
      const docxBlob = new Blob([new Uint8Array(docxBuf)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const { data: uploaded, error: uploadError } = await admin.storage
        .from('documents')
        .upload(storageKey, docxBlob);

      if (!uploadError && uploaded) {
        docxKey = uploaded.key;
        // Update database row
        await admin.database
          .from('documents')
          .update({
            title: trimmedTitle,
            description: trimmedDesc,
            content,
            docx_url: uploaded.url,
            docx_key: uploaded.key,
          })
          .eq('chat_id', chatId)
          .eq('doc_index', docIndex)
          .eq('user_id', auth.user.id);
      }
    }

    return NextResponse.json({
      success: true,
      title: trimmedTitle,
      description: trimmedDesc,
      content,
      docx: docxBase64,
      docxKey,
    });
  } catch (error) {
    console.error('Failed to update document:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update document.' },
      { status: 500 },
    );
  }
}
