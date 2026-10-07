import type { NextRequest } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { pruneRateLimits } from '@/server/api/rate-limit';
import { pruneNotifications } from '@/server/notifications/service';
import { runReminders } from '@/server/reminders/run';

// Up to 500 emails a run, one SMTP send each.
export const maxDuration = 300;

/**
 * Reminders and daily digests, scheduled in vercel.json. Daily on Vercel Hobby;
 * the same code runs hourly on Pro (see REMINDER_CRON_HOURLY).
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const result = await runReminders();
  // Housekeeping (REST API counters, old bell history) rides on this cron
  // because it always runs. After the emails, and never fatal.
  await pruneRateLimits().catch((error) => console.error('[cron] pruneRateLimits', error));
  await pruneNotifications().catch((error) => console.error('[cron] pruneNotifications', error));
  return Response.json(result);
}
