import { timingSafeEqual } from 'node:crypto';

/** Vercel Cron's bearer check, shared by every route under /api/cron. */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured means no cron: never run a job for an anonymous caller.
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
