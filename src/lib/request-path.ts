/** Set by src/proxy.ts on page requests: the requested path plus query string. */
export const REQUEST_PATH_HEADER = 'x-taskeeper-path';

/**
 * The ?redirectTo= that better-auth-ui reads from window.location on the
 * client, worked out on the server from the forwarded path. Without it the
 * server renders auth links with the default, and they hydrate pointing
 * there, so an invitee who switches from sign-up to sign-in loses the invite.
 */
export function redirectToFromPath(path: string | null, fallback = '/'): string {
  const query = path?.split('?')[1] ?? '';
  return new URLSearchParams(query).get('redirectTo')?.trim() || fallback;
}
