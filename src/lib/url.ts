/**
 * Public origin of the app, without a trailing slash.
 *
 * BETTER_AUTH_URL wins when set. On Vercel it is often absent or pinned to the
 * production domain while the request arrives on a preview/deployment domain;
 * better-auth then rejects the request with "Invalid origin", because its
 * trusted-origin list is derived from baseURL alone. VERCEL_URL is the origin
 * the browser actually used for this deployment, so it is the right fallback.
 */
export function appUrl(): string {
  const explicit = process.env.BETTER_AUTH_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return 'http://localhost:3000';
}

/** Every origin auth requests may legitimately come from. */
export function trustedOrigins(): string[] {
  const origins = new Set([appUrl()]);

  // Preview deployments are served from a per-deployment hostname that differs
  // from the production domain, so it must be trusted in addition to appUrl().
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }
  if (process.env.VERCEL_BRANCH_URL) origins.add(`https://${process.env.VERCEL_BRANCH_URL}`);

  return [...origins];
}
