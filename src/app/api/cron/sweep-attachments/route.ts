import type { NextRequest } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { storageEnabled } from '@/lib/storage';
import { sweepAttachments } from '@/server/attachments/sweep';

// Listing the whole bucket can take a while once it holds many files.
export const maxDuration = 300;

/**
 * Daily run of yarn attachments:sweep, scheduled in vercel.json. Deletes clean
 * up their own files; this catches the rest — uploads never confirmed, and
 * purges that failed.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  if (!storageEnabled()) return Response.json({ skipped: 'storage not configured' });

  const result = await sweepAttachments({ dryRun: false });
  return Response.json(result);
}
