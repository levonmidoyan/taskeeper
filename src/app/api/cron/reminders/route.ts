import type { NextRequest } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { runReminders } from '@/server/reminders/run';

// Up to 500 emails a run, one Resend call each.
export const maxDuration = 300;

/**
 * Reminders and daily digests, scheduled in vercel.json. Daily on Vercel Hobby;
 * the same code runs hourly on Pro (see REMINDER_CRON_HOURLY).
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  return Response.json(await runReminders());
}
