import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { storageEnabled } from '@/lib/storage';
import { sweepAttachments } from '@/server/attachments/sweep';

// Listing the whole bucket can take a while once it holds many files.
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured means no cron: never run the sweep for an anonymous caller.
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily run of yarn attachments:sweep, scheduled in vercel.json. Deletes clean
 * up their own files; this catches the rest — uploads never confirmed, and
 * purges that failed.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 });
  if (!storageEnabled()) return Response.json({ skipped: 'storage not configured' });

  const result = await sweepAttachments({ dryRun: false });
  return Response.json(result);
}
