import { auth } from '@/lib/auth';
import { readTextPreview } from '@/server/attachments/download';

/**
 * The start of a text attachment for the preview modal. Always plain text
 * with nosniff, so an HTML or SVG file shows as source and never renders.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { id } = await params;
  const preview = await readTextPreview(session.user.id, id);
  if (preview.status === 'missing') return new Response('Not found', { status: 404 });
  if (preview.status === 'unsupported') return new Response('Not a text file', { status: 415 });

  return new Response(preview.text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'X-Preview-Truncated': preview.truncated ? '1' : '0',
    },
  });
}
