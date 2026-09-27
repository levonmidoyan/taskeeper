import { safeNextPath } from '@/lib/next-path';

/**
 * Auth views that only make sense for a signed-out visitor. Everything else
 * (sign-out, callback, verify-email, reset-password, two-factor, device, …) is
 * either used while signed in or finishes a sign-in in progress, so it stays
 * reachable.
 */
const SIGNED_OUT_ONLY_PATHS = new Set([
  'sign-in',
  'sign-up',
  'forgot-password',
  'reset-link-sent',
  'email-otp',
]);

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Where to send a signed-in user who opens `/auth/<path>`, or `null` to render
 * the view. Honours a same-origin `?redirectTo=`. While `addingAccount` (the
 * "Add account" dialog handed off to a full page) every view renders.
 */
export function signedInAuthRedirect(
  path: string,
  searchParams: SearchParams,
  { addingAccount = false }: { addingAccount?: boolean } = {},
): string | null {
  if (addingAccount || !SIGNED_OUT_ONLY_PATHS.has(path)) return null;

  const redirectTo = searchParams.redirectTo;
  return safeNextPath(typeof redirectTo === 'string' ? redirectTo : null);
}
